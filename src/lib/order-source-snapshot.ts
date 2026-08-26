import { inventoryEvidenceBindingRequired } from "./inventory-evidence-binding";

const MAX_INVENTORY_FUTURE_SKEW_MS = 5 * 60_000;

export type OrderInventoryEvidenceV1 = {
  version: 1;
  supplierOfferId: string;
  idempotencyKey: string;
  availability: string;
  quantity: number | null;
  inventoryConfidenceBps: number;
  observedPriceCents: number | null;
  observedAt: string;
  expiresAt: string;
  verificationMethod: string;
  provenanceHash: string;
  sourceHealth: string;
};

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
  inventoryEvidence?: OrderInventoryEvidenceV1;
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

function nullableNonNegativeInteger(value: unknown) {
  if (value === null) return null;
  return safeNonNegativeInteger(value);
}

function parseInventoryEvidence(value: unknown, persistedOfferId: string): OrderInventoryEvidenceV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const evidence = value as Record<string, unknown>;
  const supplierOfferId = boundedString(evidence.supplierOfferId, 128);
  const idempotencyKey = boundedString(evidence.idempotencyKey, 256);
  const availability = boundedString(evidence.availability, 40);
  const quantity = nullableNonNegativeInteger(evidence.quantity);
  const inventoryConfidenceBps = safeNonNegativeInteger(evidence.inventoryConfidenceBps);
  const observedPriceCents = nullableNonNegativeInteger(evidence.observedPriceCents);
  const observedAt = isoTimestamp(evidence.observedAt);
  const expiresAt = isoTimestamp(evidence.expiresAt);
  const verificationMethod = boundedString(evidence.verificationMethod, 80);
  const provenanceHash = boundedString(evidence.provenanceHash, 128);
  const sourceHealth = boundedString(evidence.sourceHealth, 80);
  if (
    evidence.version !== 1 || supplierOfferId !== persistedOfferId || !idempotencyKey || !availability ||
    (quantity === null && evidence.quantity !== null) || inventoryConfidenceBps === null || inventoryConfidenceBps > 10_000 ||
    (observedPriceCents === null && evidence.observedPriceCents !== null) || !observedAt || !expiresAt ||
    Date.parse(expiresAt) <= Date.parse(observedAt) || !verificationMethod || !provenanceHash ||
    !/^[a-f0-9]{64}$/i.test(provenanceHash) || !sourceHealth
  ) return null;
  return {
    version: 1,
    supplierOfferId,
    idempotencyKey,
    availability,
    quantity,
    inventoryConfidenceBps,
    observedPriceCents,
    observedAt,
    expiresAt,
    verificationMethod,
    provenanceHash: provenanceHash.toLowerCase(),
    sourceHealth,
  };
}

export function buildOrderSupplierSnapshot(
  specifications: string,
  currency: string,
  nowMs = Date.now(),
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
      !persistedSupplierId || !persistedOfferId || !persistedOfferKey || !supplierName || !sourceClass ||
      !sourceVerifiedAt || !priceVerifiedAt || (offer.sourceUrl !== null && !sourceUrl) || offer.resaleAllowed !== true ||
      inventoryConfidenceBps === null || inventoryConfidenceBps > 10_000 || !availability || !/^[a-z]{3}$/.test(normalizedCurrency) ||
      itemCostCents === null || shippingCents === null || taxCents === null || supplierFeeCents === null ||
      handlingCents === null || landedCostCents === null
    ) return null;

    const inventoryEvidence = parseInventoryEvidence(offer.inventoryEvidenceV1, persistedOfferId);
    const evidenceRequired = inventoryEvidenceBindingRequired();
    if (evidenceRequired && !inventoryEvidence) return null;
    if (inventoryEvidence) {
      if (inventoryEvidence.availability !== availability || inventoryEvidence.inventoryConfidenceBps !== inventoryConfidenceBps) return null;
      if (inventoryEvidence.observedPriceCents !== null && inventoryEvidence.observedPriceCents !== itemCostCents) return null;
      if (evidenceRequired) {
        const observedAtMs = Date.parse(inventoryEvidence.observedAt);
        const expiresAtMs = Date.parse(inventoryEvidence.expiresAt);
        if (observedAtMs > nowMs + MAX_INVENTORY_FUTURE_SKEW_MS || nowMs >= expiresAtMs) return null;
      }
    }

    const recomputedLandedCost = itemCostCents + shippingCents + taxCents + supplierFeeCents + handlingCents;
    if (!Number.isSafeInteger(recomputedLandedCost) || recomputedLandedCost !== landedCostCents) return null;

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
      ...(inventoryEvidence ? { inventoryEvidence } : {}),
      currency: normalizedCurrency,
      costBreakdown: { itemCostCents, shippingCents, taxCents, supplierFeeCents, handlingCents, landedCostCents },
    };
  } catch {
    return null;
  }
}

export function serializeOrderSupplierSnapshot(snapshot: OrderSupplierSnapshotV1 | null) {
  return snapshot ? JSON.stringify(snapshot) : "{}";
}
