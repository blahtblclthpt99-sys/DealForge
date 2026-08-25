import { MIN_INVENTORY_CONFIDENCE_BPS } from "./commercialization";
import { prisma } from "./db";
import { evaluateInventoryFreshness } from "./inventory-freshness";
import {
  readLatestInventoryObservation,
  recordInventoryObservation,
  type RecordInventoryObservationInput,
} from "./inventory-observation-store";

const MAX_SWEEP_OFFERS = 250;

export type InventoryObservationOperationInput = RecordInventoryObservationInput & {
  actor: string;
};

function demotedAvailability(observation: {
  availability: string;
  quantity?: number | null;
} | null) {
  if (!observation) return "unknown";
  if (observation.availability.trim().toLowerCase() === "out_of_stock" || observation.quantity === 0) {
    return "out_of_stock";
  }
  return "unknown";
}

async function enginePaused() {
  const config = await prisma.productEngineConfig.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
    select: { paused: true },
  });
  return config.paused;
}

async function audit(actor: string, action: string, detail: Record<string, unknown>) {
  await prisma.productEngineAudit.create({
    data: {
      candidateId: null,
      actor,
      action,
      detail: JSON.stringify(detail),
    },
  });
}

async function demoteProductForInventory(
  productId: string,
  availability: "out_of_stock" | "unknown",
  actor: string,
  detail: Record<string, unknown>,
) {
  const result = await prisma.product.updateMany({
    where: {
      id: productId,
      OR: [
        { commerceEnabled: true },
        { availability: { not: availability } },
      ],
    },
    data: {
      commerceEnabled: false,
      availability,
    },
  });
  if (result.count > 0) {
    await audit(actor, "inventory_product_demoted", { productId, availability, ...detail });
  }
  return result.count;
}

/**
 * Accept trusted normalized evidence for one exact persisted supplier offer.
 * Positive evidence never enables commerce. Negative/missing/stale evidence may
 * only reduce eligibility, keeping inventory automation monotonic-safe.
 */
export async function applyInventoryObservation(
  input: InventoryObservationOperationInput,
  nowMs = Date.now(),
) {
  if (await enginePaused()) return { paused: true as const };

  const offer = await prisma.supplierOffer.findUnique({
    where: { id: input.supplierOfferId.trim() },
    select: {
      id: true,
      productId: true,
      active: true,
      availability: true,
      inventoryConfidenceBps: true,
      supplier: {
        select: {
          id: true,
          active: true,
          resaleAllowed: true,
        },
      },
    },
  });
  if (!offer) throw new Error("SUPPLIER_OFFER_NOT_FOUND");
  if (!offer.active || !offer.supplier.active || !offer.supplier.resaleAllowed) {
    throw new Error("SUPPLIER_OFFER_NOT_OBSERVABLE");
  }

  const recorded = await recordInventoryObservation(input);
  const latest = await readLatestInventoryObservation(offer.id);
  const submittedAt = input.observedAt.getTime();
  const latestAt = latest?.observedAt?.getTime() ?? Number.NaN;
  const submittedIsLatest = Number.isFinite(latestAt) && latestAt === submittedAt;

  if (!submittedIsLatest || !latest) {
    await audit(input.actor, "inventory_observation_older_than_current", {
      supplierOfferId: offer.id,
      productId: offer.productId,
      idempotencyKey: recorded.idempotencyKey,
    });
    return {
      paused: false as const,
      applied: false,
      idempotencyKey: recorded.idempotencyKey,
      reason: "OLDER_THAN_CURRENT_OBSERVATION",
    };
  }

  const freshness = evaluateInventoryFreshness(
    latest,
    { minInventoryConfidenceBps: MIN_INVENTORY_CONFIDENCE_BPS, requireCurrent: true },
    nowMs,
  );

  // Keep normalized offer state synchronized with the latest evidence. If these
  // values drift from the commercialized Product snapshot, checkout fails closed
  // until the normal commercialization gate deliberately refreshes that snapshot.
  await prisma.supplierOffer.update({
    where: { id: offer.id },
    data: {
      availability: latest.availability.trim().toLowerCase(),
      inventoryConfidenceBps: latest.inventoryConfidenceBps,
    },
  });

  let demoted = 0;
  if (!freshness.promotable) {
    demoted = await demoteProductForInventory(
      offer.productId,
      demotedAvailability(latest),
      input.actor,
      {
        supplierOfferId: offer.id,
        freshnessState: freshness.state,
        reasons: freshness.reasons,
      },
    );
  }

  await audit(input.actor, "inventory_observation_applied", {
    supplierOfferId: offer.id,
    productId: offer.productId,
    idempotencyKey: recorded.idempotencyKey,
    freshnessState: freshness.state,
    promotable: freshness.promotable,
    reasons: freshness.reasons,
    demoted: demoted > 0,
  });

  return {
    paused: false as const,
    applied: true,
    idempotencyKey: recorded.idempotencyKey,
    supplierOfferId: offer.id,
    productId: offer.productId,
    freshness,
    demoted: demoted > 0,
    commercePromoted: false as const,
  };
}

/**
 * Bounded fail-closed sweep. It checks active persisted offers and disables any
 * directly associated Product whose newest inventory evidence is absent or no
 * longer current. It never enables commerce or purchases inventory.
 */
export async function sweepInventoryFreshness(
  actor: string,
  requestedLimit = 100,
  nowMs = Date.now(),
) {
  if (await enginePaused()) return { paused: true as const, checked: 0, demoted: 0 };
  const limit = Math.max(1, Math.min(MAX_SWEEP_OFFERS, Math.trunc(requestedLimit)));

  const offers = await prisma.supplierOffer.findMany({
    where: { active: true },
    orderBy: [{ priority: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      productId: true,
      supplier: { select: { active: true, resaleAllowed: true } },
    },
  });

  let demoted = 0;
  let current = 0;
  let nonCurrent = 0;
  for (const offer of offers) {
    const observation = await readLatestInventoryObservation(offer.id);
    const freshness = evaluateInventoryFreshness(
      observation,
      { minInventoryConfidenceBps: MIN_INVENTORY_CONFIDENCE_BPS, requireCurrent: true },
      nowMs,
    );
    const supplierBlocked = !offer.supplier.active || !offer.supplier.resaleAllowed;
    if (freshness.promotable && !supplierBlocked) {
      current += 1;
      continue;
    }
    nonCurrent += 1;
    demoted += await demoteProductForInventory(
      offer.productId,
      demotedAvailability(observation),
      actor,
      {
        supplierOfferId: offer.id,
        freshnessState: freshness.state,
        reasons: supplierBlocked ? [...freshness.reasons, "supplier_not_eligible"] : freshness.reasons,
      },
    );
  }

  await audit(actor, "inventory_freshness_sweep", {
    checked: offers.length,
    current,
    nonCurrent,
    demoted,
    limit,
  });

  return {
    paused: false as const,
    checked: offers.length,
    current,
    nonCurrent,
    demoted,
    limit,
  };
}
