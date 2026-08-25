import { Prisma } from "@prisma/client";
import {
  MAX_PRICE_AGE_MINUTES,
  MAX_SOURCE_AGE_DAYS,
  MIN_INVENTORY_CONFIDENCE_BPS,
} from "./commercialization";
import { prisma } from "./db";
import type { InventoryObservationSnapshot } from "./inventory-freshness";
import { parseProcurementSupplierSnapshot } from "./procurement-intents";
import {
  computeSupplierLandedCostCents,
  evaluateSupplierOffer,
  type SupplierOfferCandidate,
} from "./supplier-offers";

export type ProcurementSourceRevalidationInput = {
  supplierSnapshot: string;
  productId: string;
  currency: string;
  expectedUnitCostCents: number | null;
};

export type LiveProcurementSupplierOffer = {
  id: string;
  offerKey: string;
  supplierId: string;
  productId: string;
  sourceUrl: string | null;
  active: boolean;
  availability: string;
  currency: string;
  itemCostCents: number;
  shippingCents: number;
  taxCents: number;
  supplierFeeCents: number;
  handlingCents: number;
  priceVerifiedAt: Date | null;
  inventoryConfidenceBps: number;
  priority: number;
  supplier: {
    name: string;
    active: boolean;
    sourceClass: string;
    resaleAllowed: boolean;
    sourceVerifiedAt: Date | null;
  };
};

export type ProcurementSourceRevalidationDecision = {
  allowed: boolean;
  reasons: string[];
  persistedOfferId: string | null;
  currentLandedCostCents: number | null;
};

type InventoryObservationRow = {
  supplierOfferId: string;
  availability: string;
  quantity: number | null;
  inventoryConfidenceBps: number;
  observedPriceCents: number | null;
  observedAt: Date;
  expiresAt: Date;
  verificationMethod: string;
  provenance: string;
  sourceHealth: string;
};

type ProcurementSourceDb = Pick<Prisma.TransactionClient, "supplierOffer" | "$queryRaw">;

function uniqueReasons(reasons: string[]) {
  return [...new Set(reasons)];
}

function toObservation(row: InventoryObservationRow | undefined): InventoryObservationSnapshot | null {
  if (!row) return null;
  return {
    supplierOfferId: row.supplierOfferId,
    availability: row.availability,
    quantity: row.quantity,
    inventoryConfidenceBps: row.inventoryConfidenceBps,
    observedPriceCents: row.observedPriceCents,
    observedAt: row.observedAt,
    expiresAt: row.expiresAt,
    verificationMethod: row.verificationMethod,
    provenance: row.provenance,
    sourceHealth: row.sourceHealth,
  };
}

function validSnapshotTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function evaluateProcurementSourceRevalidation(
  input: ProcurementSourceRevalidationInput,
  liveOffer: LiveProcurementSupplierOffer | null,
  latestInventoryObservation: InventoryObservationSnapshot | null,
  nowMs = Date.now(),
): ProcurementSourceRevalidationDecision {
  const snapshot = parseProcurementSupplierSnapshot(input.supplierSnapshot);
  if (!snapshot) {
    return {
      allowed: false,
      reasons: ["procurement_snapshot_missing_or_invalid"],
      persistedOfferId: null,
      currentLandedCostCents: null,
    };
  }

  if (!liveOffer) {
    return {
      allowed: false,
      reasons: ["persisted_offer_missing"],
      persistedOfferId: snapshot.persistedOfferId,
      currentLandedCostCents: null,
    };
  }

  const reasons: string[] = [];
  const currency = input.currency.trim().toLowerCase();
  const productId = input.productId.trim();

  if (liveOffer.id !== snapshot.persistedOfferId) reasons.push("persisted_offer_id_mismatch");
  if (liveOffer.offerKey !== snapshot.persistedOfferKey) reasons.push("persisted_offer_key_mismatch");
  if (liveOffer.supplierId !== snapshot.persistedSupplierId) reasons.push("persisted_supplier_id_mismatch");
  if (liveOffer.productId !== productId) reasons.push("persisted_offer_product_mismatch");
  if (liveOffer.supplier.sourceClass !== snapshot.sourceClass) reasons.push("persisted_source_class_drift");
  if ((liveOffer.sourceUrl ?? null) !== snapshot.sourceUrl) reasons.push("persisted_source_url_drift");
  if (snapshot.currency.trim().toLowerCase() !== currency) reasons.push("snapshot_currency_mismatch");

  const snapshotSourceVerifiedAt = validSnapshotTimestamp(snapshot.sourceVerifiedAt);
  const snapshotPriceVerifiedAt = validSnapshotTimestamp(snapshot.priceVerifiedAt);
  if (
    snapshotSourceVerifiedAt !== null &&
    liveOffer.supplier.sourceVerifiedAt &&
    liveOffer.supplier.sourceVerifiedAt.getTime() < snapshotSourceVerifiedAt
  ) {
    reasons.push("source_verification_regressed");
  }
  if (
    snapshotPriceVerifiedAt !== null &&
    liveOffer.priceVerifiedAt &&
    liveOffer.priceVerifiedAt.getTime() < snapshotPriceVerifiedAt
  ) {
    reasons.push("price_verification_regressed");
  }

  const candidate: SupplierOfferCandidate = {
    id: liveOffer.id,
    offerKey: liveOffer.offerKey,
    supplierId: liveOffer.supplierId,
    supplierName: liveOffer.supplier.name,
    sourceUrl: liveOffer.sourceUrl,
    supplierActive: liveOffer.supplier.active,
    offerActive: liveOffer.active,
    sourceClass: liveOffer.supplier.sourceClass,
    resaleAllowed: liveOffer.supplier.resaleAllowed,
    sourceVerifiedAt: liveOffer.supplier.sourceVerifiedAt,
    priceVerifiedAt: liveOffer.priceVerifiedAt,
    availability: liveOffer.availability,
    currency: liveOffer.currency,
    itemCostCents: liveOffer.itemCostCents,
    shippingCents: liveOffer.shippingCents,
    taxCents: liveOffer.taxCents,
    supplierFeeCents: liveOffer.supplierFeeCents,
    handlingCents: liveOffer.handlingCents,
    inventoryConfidenceBps: liveOffer.inventoryConfidenceBps,
    priority: liveOffer.priority,
    latestInventoryObservation,
  };

  const eligibility = evaluateSupplierOffer(
    candidate,
    {
      currency,
      maxSourceAgeDays: MAX_SOURCE_AGE_DAYS,
      maxPriceAgeMinutes: MAX_PRICE_AGE_MINUTES,
      minInventoryConfidenceBps: MIN_INVENTORY_CONFIDENCE_BPS,
      requireCurrentInventoryObservation: true,
    },
    nowMs,
  );
  reasons.push(...eligibility.reasons.map((reason) => `live_offer_${reason}`));

  if (latestInventoryObservation && latestInventoryObservation.supplierOfferId !== liveOffer.id) {
    reasons.push("inventory_observation_offer_mismatch");
  }
  if (
    latestInventoryObservation?.observedPriceCents !== null &&
    latestInventoryObservation?.observedPriceCents !== undefined &&
    latestInventoryObservation.observedPriceCents !== liveOffer.itemCostCents
  ) {
    reasons.push("observed_supplier_price_drift");
  }

  const currentLandedCostCents = computeSupplierLandedCostCents(candidate);
  if (
    currentLandedCostCents === null ||
    currentLandedCostCents !== snapshot.costBreakdown.landedCostCents ||
    currentLandedCostCents !== input.expectedUnitCostCents
  ) {
    reasons.push("procurement_landed_cost_drift");
  }

  const deduped = uniqueReasons(reasons);
  return {
    allowed: deduped.length === 0,
    reasons: deduped,
    persistedOfferId: snapshot.persistedOfferId,
    currentLandedCostCents,
  };
}

async function readLatestObservationWithClient(
  db: ProcurementSourceDb,
  supplierOfferId: string,
): Promise<InventoryObservationSnapshot | null> {
  const rows = await db.$queryRaw<InventoryObservationRow[]>(Prisma.sql`
    SELECT
      "supplierOfferId", "availability", "quantity", "inventoryConfidenceBps", "observedPriceCents",
      "observedAt", "expiresAt", "verificationMethod", "provenance", "sourceHealth"
    FROM "InventoryObservation"
    WHERE "supplierOfferId" = ${supplierOfferId}
    ORDER BY "observedAt" DESC, "createdAt" DESC, "id" DESC
    LIMIT 1
  `);
  return toObservation(rows[0]);
}

/**
 * Revalidate the exact supplier offer frozen into a paid OrderItem immediately
 * before owner approval. Newer verification evidence is accepted, but source
 * identity, current eligibility, current inventory evidence, and frozen landed
 * cost must still agree. This function is read-only and grants no purchasing
 * authority by itself.
 */
export async function checkProcurementSourceRevalidation(
  input: ProcurementSourceRevalidationInput,
  nowMs = Date.now(),
  db: ProcurementSourceDb = prisma as unknown as ProcurementSourceDb,
): Promise<ProcurementSourceRevalidationDecision> {
  const snapshot = parseProcurementSupplierSnapshot(input.supplierSnapshot);
  if (!snapshot) {
    return evaluateProcurementSourceRevalidation(input, null, null, nowMs);
  }

  const liveOffer = await db.supplierOffer.findUnique({
    where: { id: snapshot.persistedOfferId },
    select: {
      id: true,
      offerKey: true,
      supplierId: true,
      productId: true,
      sourceUrl: true,
      active: true,
      availability: true,
      currency: true,
      itemCostCents: true,
      shippingCents: true,
      taxCents: true,
      supplierFeeCents: true,
      handlingCents: true,
      priceVerifiedAt: true,
      inventoryConfidenceBps: true,
      priority: true,
      supplier: {
        select: {
          name: true,
          active: true,
          sourceClass: true,
          resaleAllowed: true,
          sourceVerifiedAt: true,
        },
      },
    },
  });

  if (!liveOffer) return evaluateProcurementSourceRevalidation(input, null, null, nowMs);
  const latestInventoryObservation = await readLatestObservationWithClient(db, liveOffer.id);
  return evaluateProcurementSourceRevalidation(input, liveOffer, latestInventoryObservation, nowMs);
}
