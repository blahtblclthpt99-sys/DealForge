import {
  MAX_PRICE_AGE_MINUTES,
  MAX_SOURCE_AGE_DAYS,
  MIN_INVENTORY_CONFIDENCE_BPS,
} from "./commercialization";
import { prisma } from "./db";
import { readLatestInventoryObservation } from "./inventory-observation-store";
import type { InventoryObservationSnapshot } from "./inventory-freshness";
import {
  computeSupplierLandedCostCents,
  evaluateSupplierOffer,
  type SupplierOfferCandidate,
} from "./supplier-offers";

export type PersistedOfferBindingInput = {
  productId: string;
  currency: string;
  availability: string;
  landedCostCents: number | null;
  priceVerifiedAt: Date | null;
  specifications: string;
};

export type LivePersistedOffer = {
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
  latestInventoryObservation?: InventoryObservationSnapshot | null;
  supplier: {
    name: string;
    active: boolean;
    sourceClass: string;
    resaleAllowed: boolean;
    sourceVerifiedAt: Date | null;
  };
};

export type PersistedOfferBindingDecision = {
  allowed: boolean;
  reasons: string[];
  persistedOfferId: string | null;
};

type PersistedOfferSnapshot = {
  persistedSupplierId: string;
  persistedOfferId: string;
  persistedOfferKey: string;
  sourceClass: string;
  sourceUrl: string | null;
  sourceVerifiedAt: string;
  priceVerifiedAt: string;
  inventoryConfidenceBps: number;
  availability: string;
  landedCostCents: number;
};

function safeString(value: unknown, maxLength = 256) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : null;
}

function safeTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? value : null;
}

function parseSnapshot(specifications: string): PersistedOfferSnapshot | null {
  try {
    const root = JSON.parse(specifications) as Record<string, unknown>;
    const rawOffer = root.supplierOfferV1;
    if (!rawOffer || typeof rawOffer !== "object" || Array.isArray(rawOffer)) return null;
    const offer = rawOffer as Record<string, unknown>;
    const rawCosts = offer.costBreakdown;
    if (!rawCosts || typeof rawCosts !== "object" || Array.isArray(rawCosts)) return null;
    const costs = rawCosts as Record<string, unknown>;

    const persistedSupplierId = safeString(offer.persistedSupplierId, 128);
    const persistedOfferId = safeString(offer.persistedOfferId, 128);
    const persistedOfferKey = safeString(offer.persistedOfferKey, 256);
    const sourceClass = safeString(offer.sourceClass, 80);
    const sourceVerifiedAt = safeTimestamp(offer.sourceVerifiedAt);
    const priceVerifiedAt = safeTimestamp(offer.priceVerifiedAt);
    const sourceUrl = offer.sourceUrl === null ? null : safeString(offer.sourceUrl, 2000);
    const inventoryConfidenceBps = offer.inventoryConfidenceBps;
    const availability = safeString(offer.availability, 40);
    const landedCostCents = costs.landedCostCents;

    if (
      !persistedSupplierId ||
      !persistedOfferId ||
      !persistedOfferKey ||
      !sourceClass ||
      !sourceVerifiedAt ||
      !priceVerifiedAt ||
      (offer.sourceUrl !== null && !sourceUrl) ||
      offer.resaleAllowed !== true ||
      !Number.isSafeInteger(inventoryConfidenceBps) ||
      (inventoryConfidenceBps as number) < 0 ||
      (inventoryConfidenceBps as number) > 10_000 ||
      !availability ||
      !Number.isSafeInteger(landedCostCents) ||
      (landedCostCents as number) <= 0
    ) {
      return null;
    }

    return {
      persistedSupplierId,
      persistedOfferId,
      persistedOfferKey,
      sourceClass,
      sourceUrl,
      sourceVerifiedAt,
      priceVerifiedAt,
      inventoryConfidenceBps: inventoryConfidenceBps as number,
      availability,
      landedCostCents: landedCostCents as number,
    };
  } catch {
    return null;
  }
}

function sameTimestamp(value: Date | null, iso: string) {
  if (!value) return false;
  const expected = Date.parse(iso);
  return Number.isFinite(expected) && value.getTime() === expected;
}

function uniqueReasons(reasons: string[]) {
  return [...new Set(reasons)];
}

export function evaluatePersistedOfferBinding(
  input: PersistedOfferBindingInput,
  liveOffer: LivePersistedOffer | null,
  nowMs = Date.now(),
): PersistedOfferBindingDecision {
  const snapshot = parseSnapshot(input.specifications);
  if (!snapshot) {
    return { allowed: false, reasons: ["persisted_offer_snapshot_missing_or_invalid"], persistedOfferId: null };
  }
  if (!liveOffer) {
    return {
      allowed: false,
      reasons: ["persisted_offer_missing"],
      persistedOfferId: snapshot.persistedOfferId,
    };
  }

  const reasons: string[] = [];
  if (liveOffer.id !== snapshot.persistedOfferId) reasons.push("persisted_offer_id_mismatch");
  if (liveOffer.offerKey !== snapshot.persistedOfferKey) reasons.push("persisted_offer_key_mismatch");
  if (liveOffer.supplierId !== snapshot.persistedSupplierId) reasons.push("persisted_supplier_id_mismatch");
  if (liveOffer.productId !== input.productId) reasons.push("persisted_offer_product_mismatch");
  if (liveOffer.supplier.sourceClass !== snapshot.sourceClass) reasons.push("persisted_source_class_drift");
  if ((liveOffer.sourceUrl ?? null) !== snapshot.sourceUrl) reasons.push("persisted_source_url_drift");
  if (!sameTimestamp(liveOffer.supplier.sourceVerifiedAt, snapshot.sourceVerifiedAt)) {
    reasons.push("persisted_source_verification_drift");
  }
  if (!sameTimestamp(liveOffer.priceVerifiedAt, snapshot.priceVerifiedAt)) {
    reasons.push("persisted_price_verification_drift");
  }
  if (!input.priceVerifiedAt || !liveOffer.priceVerifiedAt || input.priceVerifiedAt.getTime() !== liveOffer.priceVerifiedAt.getTime()) {
    reasons.push("product_price_verification_drift");
  }
  if (liveOffer.inventoryConfidenceBps !== snapshot.inventoryConfidenceBps) {
    reasons.push("persisted_inventory_confidence_drift");
  }
  if (liveOffer.availability !== snapshot.availability || input.availability !== liveOffer.availability) {
    reasons.push("persisted_availability_drift");
  }
  if (liveOffer.currency.trim().toLowerCase() !== input.currency.trim().toLowerCase()) {
    reasons.push("persisted_currency_drift");
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
    latestInventoryObservation: liveOffer.latestInventoryObservation,
  };

  const eligibility = evaluateSupplierOffer(
    candidate,
    {
      currency: input.currency,
      maxSourceAgeDays: MAX_SOURCE_AGE_DAYS,
      maxPriceAgeMinutes: MAX_PRICE_AGE_MINUTES,
      minInventoryConfidenceBps: MIN_INVENTORY_CONFIDENCE_BPS,
      requireCurrentInventoryObservation: true,
    },
    nowMs,
  );
  reasons.push(...eligibility.reasons.map((reason) => `live_offer_${reason}`));

  const observation = liveOffer.latestInventoryObservation;
  if (observation && observation.supplierOfferId !== liveOffer.id) {
    reasons.push("live_offer_inventory_observation_offer_mismatch");
  }
  if (observation && observation.availability.trim().toLowerCase() !== liveOffer.availability.trim().toLowerCase()) {
    reasons.push("live_offer_inventory_observation_availability_drift");
  }
  if (observation && observation.inventoryConfidenceBps !== liveOffer.inventoryConfidenceBps) {
    reasons.push("live_offer_inventory_observation_confidence_drift");
  }
  if (
    observation &&
    observation.observedPriceCents !== null &&
    observation.observedPriceCents !== undefined &&
    observation.observedPriceCents !== liveOffer.itemCostCents
  ) {
    reasons.push("live_offer_inventory_observation_price_drift");
  }

  const liveLandedCostCents = computeSupplierLandedCostCents(candidate);
  if (
    liveLandedCostCents === null ||
    liveLandedCostCents !== snapshot.landedCostCents ||
    liveLandedCostCents !== input.landedCostCents
  ) {
    reasons.push("persisted_landed_cost_drift");
  }

  const deduped = uniqueReasons(reasons);
  return {
    allowed: deduped.length === 0,
    reasons: deduped,
    persistedOfferId: snapshot.persistedOfferId,
  };
}

/**
 * Read-only checkout safety gate. The Product snapshot remains useful for audit,
 * but customer money cannot rely on it alone: the exact normalized supplier
 * offer referenced by the snapshot must still exist, retain a current inventory
 * observation with non-conflicting observed price evidence, and remain eligible now.
 */
export async function checkPersistedOfferBinding(
  input: PersistedOfferBindingInput,
  nowMs = Date.now(),
): Promise<PersistedOfferBindingDecision> {
  const snapshot = parseSnapshot(input.specifications);
  if (!snapshot) {
    return { allowed: false, reasons: ["persisted_offer_snapshot_missing_or_invalid"], persistedOfferId: null };
  }

  const liveOffer = await prisma.supplierOffer.findUnique({
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

  if (!liveOffer) return evaluatePersistedOfferBinding(input, null, nowMs);
  const latestInventoryObservation = await readLatestInventoryObservation(liveOffer.id);
  return evaluatePersistedOfferBinding(
    input,
    { ...liveOffer, latestInventoryObservation },
    nowMs,
  );
}
