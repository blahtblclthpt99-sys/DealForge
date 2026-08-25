export type OrderSupplierSnapshotV1 = {
  version: 1;
  persistedSupplierId: string;
  persistedOfferId: string;
  persistedOfferKey: string;
  supplierName: string;
  sourceClass: string;
  sourceUrl: string | null;
  sourceVerifiedAt: string;
  priceVerifiedAt: string;
  inventoryConfidenceBps: number;
  availability: string;
  currency: string;
  costBreakdown: {
    itemCostCents: number;
    shippingCents: number;
    taxCents: number;
    supplierFeeCents: number;
    handlingCents: number;
    landedCostCents: number;
  };
};

function boundedString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

function isoTimestamp(value: unknown) {
  const raw = boundedString(value, 64);
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function safeNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safePositiveInteger(value: unknown) {
  const parsed = safeNonNegativeInteger(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

/**
 * Produces the immutable supplier snapshot stored on an OrderItem before a
 * Stripe Checkout Session is created. The source Product metadata remains
 * mutable; paid-order sourcing must not depend on that mutable metadata later.
 */
export function buildOrderSupplierSnapshot(
  specifications: string,
  currency: string,
): OrderSupplierSnapshotV1 | null {
  try {
    const root = JSON.parse(specifications) as Record<string, unknown>;
    const rawOffer = root.supplierOfferV1;
    if (!rawOffer || typeof rawOffer !== "object" || Array.isArray(rawOffer)) return null;
    const offer = rawOffer as Record<string, unknown>;
    const rawCosts = offer.costBreakdown;
    if (!rawCosts || typeof rawCosts !== "object" || Array.isArray(rawCosts)) return null;
    const costs = rawCosts as Record<string, unknown>;

    const persistedSupplierId = boundedString(offer.persistedSupplierId, 128);
    const persistedOfferId = boundedString(offer.persistedOfferId, 128);
    const persistedOfferKey = boundedString(offer.persistedOfferKey, 256);
    const supplierName = boundedString(offer.supplierName, 160);
    const sourceClass = boundedString(offer.sourceClass, 80);
    const sourceVerifiedAt = isoTimestamp(offer.sourceVerifiedAt);
    const priceVerifiedAt = isoTimestamp(offer.priceVerifiedAt);
    const sourceUrl = offer.sourceUrl === null ? null : boundedString(offer.sourceUrl, 2000);
    const inventoryConfidenceBps = safeNonNegativeInteger(offer.inventoryConfidenceBps);
    const availability = boundedString(offer.availability, 40);
    const normalizedCurrency = currency.trim().toLowerCase();

    const itemCostCents = safePositiveInteger(costs.itemCostCents);
    const shippingCents = safeNonNegativeInteger(costs.shippingCents);
    const taxCents = safeNonNegativeInteger(costs.taxCents);
    const supplierFeeCents = safeNonNegativeInteger(costs.supplierFeeCents);
    const handlingCents = safeNonNegativeInteger(costs.handlingCents);
    const landedCostCents = safePositiveInteger(costs.landedCostCents);

    if (
      !persistedSupplierId ||
      !persistedOfferId ||
      !persistedOfferKey ||
      !supplierName ||
      !sourceClass ||
      !sourceVerifiedAt ||
      !priceVerifiedAt ||
      (offer.sourceUrl !== null && !sourceUrl) ||
      offer.resaleAllowed !== true ||
      inventoryConfidenceBps === null ||
      inventoryConfidenceBps > 10_000 ||
      !availability ||
      !/^[a-z]{3}$/.test(normalizedCurrency) ||
      itemCostCents === null ||
      shippingCents === null ||
      taxCents === null ||
      supplierFeeCents === null ||
      handlingCents === null ||
      landedCostCents === null
    ) {
      return null;
    }

    const recomputedLandedCost =
      itemCostCents + shippingCents + taxCents + supplierFeeCents + handlingCents;
    if (!Number.isSafeInteger(recomputedLandedCost) || recomputedLandedCost !== landedCostCents) {
      return null;
    }

    return {
      version: 1,
      persistedSupplierId,
      persistedOfferId,
      persistedOfferKey,
      supplierName,
      sourceClass,
      sourceUrl,
      sourceVerifiedAt,
      priceVerifiedAt,
      inventoryConfidenceBps,
      availability,
      currency: normalizedCurrency,
      costBreakdown: {
        itemCostCents,
        shippingCents,
        taxCents,
        supplierFeeCents,
        handlingCents,
        landedCostCents,
      },
    };
  } catch {
    return null;
  }
}

export function serializeOrderSupplierSnapshot(snapshot: OrderSupplierSnapshotV1 | null) {
  return snapshot ? JSON.stringify(snapshot) : "{}";
}
