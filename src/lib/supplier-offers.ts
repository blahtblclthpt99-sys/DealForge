import { evaluateInventoryFreshness, type InventoryObservationSnapshot } from "./inventory-freshness";
import { isDirectResaleSourceClass } from "./source-policy";

export type SupplierOfferCandidate = {
  id: string;
  supplierId: string;
  supplierName?: string;
  offerKey?: string;
  sourceUrl?: string | null;
  supplierActive: boolean;
  offerActive: boolean;
  sourceClass: string;
  resaleAllowed: boolean;
  sourceVerifiedAt: Date | null;
  priceVerifiedAt: Date | null;
  availability: string;
  currency: string;
  itemCostCents: number;
  shippingCents: number;
  taxCents: number;
  supplierFeeCents: number;
  handlingCents: number;
  inventoryConfidenceBps: number;
  priority: number;
  latestInventoryObservation?: InventoryObservationSnapshot | null;
};

export type SupplierSelectionPolicy = {
  currency: string;
  maxSourceAgeDays: number;
  maxPriceAgeMinutes: number;
  minInventoryConfidenceBps: number;
  requireCurrentInventoryObservation?: boolean;
};

export type EvaluatedSupplierOffer = {
  offer: SupplierOfferCandidate;
  eligible: boolean;
  reasons: string[];
  landedCostCents: number | null;
};

export type SupplierSelectionResult = {
  selected: EvaluatedSupplierOffer | null;
  evaluated: EvaluatedSupplierOffer[];
};

function safeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function safeBasisPoints(value: unknown): value is number {
  return safeNonNegativeInteger(value) && value <= 10_000;
}

function ageValid(value: Date | null, nowMs: number, maxAgeMs: number) {
  if (!value) return false;
  const timestamp = value.getTime();
  if (!Number.isFinite(timestamp)) return false;
  if (timestamp > nowMs + 5 * 60_000) return false;
  return nowMs - timestamp <= maxAgeMs;
}

export function computeSupplierLandedCostCents(
  offer: Pick<
    SupplierOfferCandidate,
    "itemCostCents" | "shippingCents" | "taxCents" | "supplierFeeCents" | "handlingCents"
  >,
) {
  const values = [
    offer.itemCostCents,
    offer.shippingCents,
    offer.taxCents,
    offer.supplierFeeCents,
    offer.handlingCents,
  ];
  if (!values.every(safeNonNegativeInteger) || offer.itemCostCents <= 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}

export function evaluateSupplierOffer(
  offer: SupplierOfferCandidate,
  policy: SupplierSelectionPolicy,
  nowMs = Date.now(),
): EvaluatedSupplierOffer {
  const reasons: string[] = [];
  const normalizedCurrency = offer.currency.trim().toLowerCase();
  const expectedCurrency = policy.currency.trim().toLowerCase();

  if (!offer.id.trim()) reasons.push("offer_id_invalid");
  if (!offer.supplierId.trim()) reasons.push("supplier_id_invalid");
  if (!offer.supplierActive) reasons.push("supplier_inactive");
  if (!offer.offerActive) reasons.push("offer_inactive");
  if (!isDirectResaleSourceClass(offer.sourceClass)) reasons.push("source_class_not_direct_resale");
  if (!offer.resaleAllowed) reasons.push("resale_not_verified");

  if (!/^[a-z]{3}$/.test(expectedCurrency)) {
    reasons.push("currency_policy_invalid");
  } else if (!/^[a-z]{3}$/.test(normalizedCurrency) || normalizedCurrency !== expectedCurrency) {
    reasons.push("currency_mismatch");
  }

  if (!Number.isSafeInteger(policy.maxSourceAgeDays) || policy.maxSourceAgeDays <= 0 || policy.maxSourceAgeDays > 365) {
    reasons.push("source_age_policy_invalid");
  } else if (!ageValid(offer.sourceVerifiedAt, nowMs, policy.maxSourceAgeDays * 86_400_000)) {
    reasons.push("source_verification_stale_or_invalid");
  }

  if (!Number.isSafeInteger(policy.maxPriceAgeMinutes) || policy.maxPriceAgeMinutes <= 0 || policy.maxPriceAgeMinutes > 10_080) {
    reasons.push("price_age_policy_invalid");
  } else if (!ageValid(offer.priceVerifiedAt, nowMs, policy.maxPriceAgeMinutes * 60_000)) {
    reasons.push("price_verification_stale_or_invalid");
  }

  const observationRequired = policy.requireCurrentInventoryObservation === true;
  if (observationRequired) {
    const freshness = evaluateInventoryFreshness(
      offer.latestInventoryObservation,
      { minInventoryConfidenceBps: policy.minInventoryConfidenceBps, requireCurrent: true },
      nowMs,
    );
    reasons.push(...freshness.reasons);
  } else {
    if (offer.availability !== "in_stock") reasons.push("inventory_not_in_stock");
    if (!safeBasisPoints(offer.inventoryConfidenceBps)) {
      reasons.push("inventory_confidence_invalid");
    } else if (!safeBasisPoints(policy.minInventoryConfidenceBps)) {
      reasons.push("inventory_confidence_policy_invalid");
    } else if (offer.inventoryConfidenceBps < policy.minInventoryConfidenceBps) {
      reasons.push("inventory_confidence_below_floor");
    }
  }

  if (!Number.isSafeInteger(offer.priority) || offer.priority < 0) reasons.push("priority_invalid");

  const landedCostCents = computeSupplierLandedCostCents(offer);
  if (landedCostCents === null) reasons.push("landed_cost_invalid");

  return {
    offer,
    eligible: reasons.length === 0,
    reasons,
    landedCostCents,
  };
}

/**
 * Selects a verified source only. This is intentionally a pure decision
 * function: it does not purchase, mutate catalog state, or enable commerce.
 * The selected offer must still pass DealForge commercialization and checkout
 * gates before customer money can be accepted.
 */
export function selectBestSupplierOffer(
  offers: SupplierOfferCandidate[],
  policy: SupplierSelectionPolicy,
  nowMs = Date.now(),
): SupplierSelectionResult {
  const evaluated = offers.map((offer) => evaluateSupplierOffer(offer, policy, nowMs));
  const eligible = evaluated.filter((entry) => entry.eligible && entry.landedCostCents !== null);

  eligible.sort((left, right) => {
    const landedDelta = (left.landedCostCents ?? Number.MAX_SAFE_INTEGER)
      - (right.landedCostCents ?? Number.MAX_SAFE_INTEGER);
    if (landedDelta !== 0) return landedDelta;
    if (left.offer.priority !== right.offer.priority) return left.offer.priority - right.offer.priority;
    if (left.offer.inventoryConfidenceBps !== right.offer.inventoryConfidenceBps) {
      return right.offer.inventoryConfidenceBps - left.offer.inventoryConfidenceBps;
    }
    if (left.offer.supplierId !== right.offer.supplierId) {
      return left.offer.supplierId.localeCompare(right.offer.supplierId);
    }
    return left.offer.id.localeCompare(right.offer.id);
  });

  return {
    selected: eligible[0] ?? null,
    evaluated,
  };
}
