export const DIRECT_RESALE_SOURCE_CLASSES = new Set([
  "manufacturer",
  "wholesale",
  "distributor",
  "authorized_dropshipper",
  "retailer_permitting_resale",
]);

export type SupplierOfferCandidate = {
  id: string;
  supplierId: string;
  supplierActive: boolean;
  offerActive: boolean;
  sourceClass: string;
  resaleAllowed: boolean;
  sourceVerifiedAt: Date | null;
  priceVerifiedAt: Date | null;
  availability: string;
  currency: string;
  unitCostCents: number;
  shippingCents: number;
  taxCents: number;
  handlingCents: number;
  inventoryConfidenceBps: number;
  priority: number;
};

export type SupplierSelectionPolicy = {
  currency: string;
  maxSourceAgeDays: number;
  maxPriceAgeMinutes: number;
  minInventoryConfidenceBps: number;
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

export function computeLandedCostCents(
  offer: Pick<SupplierOfferCandidate, "unitCostCents" | "shippingCents" | "taxCents" | "handlingCents">,
) {
  const values = [offer.unitCostCents, offer.shippingCents, offer.taxCents, offer.handlingCents];
  if (!values.every(safeNonNegativeInteger) || offer.unitCostCents <= 0) return null;
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

  if (!offer.supplierActive) reasons.push("supplier_inactive");
  if (!offer.offerActive) reasons.push("offer_inactive");
  if (!DIRECT_RESALE_SOURCE_CLASSES.has(offer.sourceClass)) reasons.push("source_class_not_direct_resale");
  if (!offer.resaleAllowed) reasons.push("resale_not_verified");
  if (offer.availability !== "in_stock") reasons.push("inventory_not_in_stock");
  if (!/^[a-z]{3}$/.test(normalizedCurrency) || normalizedCurrency !== expectedCurrency) {
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

  if (!safeBasisPoints(offer.inventoryConfidenceBps)) {
    reasons.push("inventory_confidence_invalid");
  } else if (!safeBasisPoints(policy.minInventoryConfidenceBps)) {
    reasons.push("inventory_confidence_policy_invalid");
  } else if (offer.inventoryConfidenceBps < policy.minInventoryConfidenceBps) {
    reasons.push("inventory_confidence_below_floor");
  }

  if (!Number.isSafeInteger(offer.priority) || offer.priority < 0) reasons.push("priority_invalid");

  const landedCostCents = computeLandedCostCents(offer);
  if (landedCostCents === null) reasons.push("landed_cost_invalid");

  return {
    offer,
    eligible: reasons.length === 0,
    reasons,
    landedCostCents,
  };
}

export function selectBestSupplierOffer(
  offers: SupplierOfferCandidate[],
  policy: SupplierSelectionPolicy,
  nowMs = Date.now(),
): SupplierSelectionResult {
  const evaluated = offers.map((offer) => evaluateSupplierOffer(offer, policy, nowMs));
  const eligible = evaluated.filter((entry) => entry.eligible && entry.landedCostCents !== null);

  eligible.sort((left, right) => {
    const landedDelta = (left.landedCostCents ?? Number.MAX_SAFE_INTEGER) - (right.landedCostCents ?? Number.MAX_SAFE_INTEGER);
    if (landedDelta !== 0) return landedDelta;
    if (left.offer.priority !== right.offer.priority) return left.offer.priority - right.offer.priority;
    if (left.offer.inventoryConfidenceBps !== right.offer.inventoryConfidenceBps) {
      return right.offer.inventoryConfidenceBps - left.offer.inventoryConfidenceBps;
    }
    return left.offer.id.localeCompare(right.offer.id);
  });

  return {
    selected: eligible[0] ?? null,
    evaluated,
  };
}
