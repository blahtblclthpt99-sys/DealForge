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

function observedPriceDrift(
  observation: { observedPriceCents?: number | null } | null,
  persistedItemCostCents: number,
) {
  const observed = observation?.observedPriceCents;
  return observed !== null && observed !== undefined && observed !== persistedItemCostCents;
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
 * Positive evidence never enables commerce. Negative/missing/stale evidence or
 * a newly observed item-price change may only reduce eligibility, keeping
 * inventory automation monotonic-safe.
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
      itemCostCents: true,
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
  const priceDrift = observedPriceDrift(latest, offer.itemCostCents);
  const safetyReasons = priceDrift
    ? [...freshness.reasons, "observed_supplier_price_drift"]
    : freshness.reasons;

  // Keep normalized inventory state synchronized with the latest evidence. Item
  // cost is intentionally NOT rewritten here: a changed observed price requires
  // the full commercialization/landed-cost/profit gate to re-verify economics.
  await prisma.supplierOffer.update({
    where: { id: offer.id },
    data: {
      availability: latest.availability.trim().toLowerCase(),
      inventoryConfidenceBps: latest.inventoryConfidenceBps,
    },
  });

  let demoted = 0;
  if (!freshness.promotable || priceDrift) {
    demoted = await demoteProductForInventory(
      offer.productId,
      demotedAvailability(latest),
      input.actor,
      {
        supplierOfferId: offer.id,
        freshnessState: freshness.state,
        reasons: safetyReasons,
        observedPriceCents: latest.observedPriceCents ?? null,
        persistedItemCostCents: offer.itemCostCents,
      },
    );
  }

  await audit(input.actor, "inventory_observation_applied", {
    supplierOfferId: offer.id,
    productId: offer.productId,
    idempotencyKey: recorded.idempotencyKey,
    freshnessState: freshness.state,
    promotable: freshness.promotable && !priceDrift,
    reasons: safetyReasons,
    priceDrift,
    observedPriceCents: latest.observedPriceCents ?? null,
    persistedItemCostCents: offer.itemCostCents,
    demoted: demoted > 0,
  });

  return {
    paused: false as const,
    applied: true,
    idempotencyKey: recorded.idempotencyKey,
    supplierOfferId: offer.id,
    productId: offer.productId,
    freshness: {
      ...freshness,
      promotable: freshness.promotable && !priceDrift,
      reasons: safetyReasons,
    },
    priceDrift,
    demoted: demoted > 0,
    commercePromoted: false as const,
  };
}

/**
 * Bounded fail-closed sweep. It checks active persisted offers and disables any
 * directly associated Product whose newest inventory evidence is absent, stale,
 * economically inconsistent, or otherwise no longer current. It never enables
 * commerce or purchases inventory.
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
      itemCostCents: true,
      supplier: { select: { active: true, resaleAllowed: true } },
    },
  });

  let demoted = 0;
  let current = 0;
  let nonCurrent = 0;
  let priceDrifted = 0;
  for (const offer of offers) {
    const observation = await readLatestInventoryObservation(offer.id);
    const freshness = evaluateInventoryFreshness(
      observation,
      { minInventoryConfidenceBps: MIN_INVENTORY_CONFIDENCE_BPS, requireCurrent: true },
      nowMs,
    );
    const supplierBlocked = !offer.supplier.active || !offer.supplier.resaleAllowed;
    const priceDrift = observedPriceDrift(observation, offer.itemCostCents);
    if (freshness.promotable && !supplierBlocked && !priceDrift) {
      current += 1;
      continue;
    }

    nonCurrent += 1;
    if (priceDrift) priceDrifted += 1;
    const reasons = [
      ...freshness.reasons,
      ...(supplierBlocked ? ["supplier_not_eligible"] : []),
      ...(priceDrift ? ["observed_supplier_price_drift"] : []),
    ];
    demoted += await demoteProductForInventory(
      offer.productId,
      demotedAvailability(observation),
      actor,
      {
        supplierOfferId: offer.id,
        freshnessState: freshness.state,
        reasons,
        observedPriceCents: observation?.observedPriceCents ?? null,
        persistedItemCostCents: offer.itemCostCents,
      },
    );
  }

  await audit(actor, "inventory_freshness_sweep", {
    checked: offers.length,
    current,
    nonCurrent,
    priceDrifted,
    demoted,
    limit,
  });

  return {
    paused: false as const,
    checked: offers.length,
    current,
    nonCurrent,
    priceDrifted,
    demoted,
    limit,
  };
}
