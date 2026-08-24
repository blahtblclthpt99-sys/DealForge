import { evaluateCommerceGate, type CommerceGateDecision } from "@/lib/commerce-gate";

export const DIRECT_RESALE_SOURCE_CLASSES = [
  "manufacturer",
  "wholesale",
  "distributor",
  "authorized_dropshipper",
  "retailer_permitting_resale",
] as const;

export type DirectResaleSourceClass = (typeof DIRECT_RESALE_SOURCE_CLASSES)[number];

export type CommercializationInput = {
  supplierName: string;
  sourceClass: DirectResaleSourceClass;
  sourceUrl?: string | null;
  resaleAllowed: true;
  sourceVerifiedAt: string;
  priceVerifiedAt: string;
  itemCostCents: number;
  shippingCents: number;
  taxCents: number;
  supplierFeeCents: number;
  handlingCents: number;
  sellingPriceCents: number;
  inventoryConfidenceBps: number;
  acquisitionReserveCents: number;
  availability: "in_stock" | "out_of_stock" | "unknown";
};

export type PreparedCommercialization = {
  sellingPriceCents: number;
  landedCostCents: number;
  priceVerifiedAt: Date;
  availability: CommercializationInput["availability"];
  specifications: string;
  commerceEnabled: boolean;
  decision: CommerceGateDecision;
};

const MIN_PROFIT_CENTS = 500;
const MIN_MARGIN_BPS = 1000;
const MIN_INVENTORY_CONFIDENCE_BPS = 8000;
const MAX_SOURCE_AGE_DAYS = 30;
const MAX_PRICE_AGE_MINUTES = 180;

function safePositiveInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field.toUpperCase()}_INVALID`);
  return value;
}

function safeNonNegativeInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field.toUpperCase()}_INVALID`);
  return value;
}

function safeBasisPoints(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`${field.toUpperCase()}_INVALID`);
  }
  return value;
}

function safeTimestamp(value: string, field: string, nowMs: number) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${field.toUpperCase()}_INVALID`);
  if (timestamp > nowMs + 5 * 60_000) throw new Error(`${field.toUpperCase()}_IN_FUTURE`);
  return new Date(timestamp);
}

function safeSourceUrl(value: string | null | undefined) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("SOURCE_URL_HTTPS_REQUIRED");
  if (url.username || url.password) throw new Error("SOURCE_URL_CREDENTIALS_NOT_ALLOWED");
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error("SOURCE_URL_PRIVATE_HOST");
  }
  return url.toString().slice(0, 2000);
}

function percentageReserve(amountCents: number, basisPoints: number) {
  return Math.ceil((amountCents * basisPoints) / 10_000);
}

function parseSpecifications(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fail closed by replacing malformed legacy metadata with a new object.
  }
  return {} as Record<string, unknown>;
}

export function isInternalCertificationSpecifications(specifications: string) {
  const root = parseSpecifications(specifications);
  return root.internalCertification === true;
}

export function prepareCommercialization(
  existingSpecifications: string,
  input: CommercializationInput,
  nowMs = Date.now(),
): PreparedCommercialization {
  if (isInternalCertificationSpecifications(existingSpecifications)) {
    throw new Error("CERTIFICATION_PRODUCT_IMMUTABLE");
  }

  const supplierName = input.supplierName.trim();
  if (supplierName.length < 2 || supplierName.length > 160) throw new Error("SUPPLIER_NAME_INVALID");
  if (!DIRECT_RESALE_SOURCE_CLASSES.includes(input.sourceClass)) throw new Error("SOURCE_CLASS_INVALID");
  if (input.resaleAllowed !== true) throw new Error("RESALE_AUTHORIZATION_REQUIRED");

  const sourceUrl = safeSourceUrl(input.sourceUrl);
  const sourceVerifiedAt = safeTimestamp(input.sourceVerifiedAt, "source_verified_at", nowMs);
  const priceVerifiedAt = safeTimestamp(input.priceVerifiedAt, "price_verified_at", nowMs);
  const itemCostCents = safePositiveInteger(input.itemCostCents, "item_cost_cents");
  const shippingCents = safeNonNegativeInteger(input.shippingCents, "shipping_cents");
  const taxCents = safeNonNegativeInteger(input.taxCents, "tax_cents");
  const supplierFeeCents = safeNonNegativeInteger(input.supplierFeeCents, "supplier_fee_cents");
  const handlingCents = safeNonNegativeInteger(input.handlingCents, "handling_cents");
  const sellingPriceCents = safePositiveInteger(input.sellingPriceCents, "selling_price_cents");
  const inventoryConfidenceBps = safeBasisPoints(input.inventoryConfidenceBps, "inventory_confidence_bps");
  const acquisitionReserveCents = safeNonNegativeInteger(input.acquisitionReserveCents, "acquisition_reserve_cents");

  const landedCostCents = itemCostCents + shippingCents + taxCents + supplierFeeCents + handlingCents;
  if (!Number.isSafeInteger(landedCostCents) || landedCostCents <= 0) throw new Error("LANDED_COST_INVALID");

  // Conservative initial reserves. These are intentionally stronger than a
  // bare processor-fee estimate and can later be replaced by learned reserves.
  const reserves = {
    paymentCents: percentageReserve(sellingPriceCents, 350) + 30,
    returnsCents: percentageReserve(sellingPriceCents, 300),
    chargebackCents: percentageReserve(sellingPriceCents, 100),
    fraudCents: percentageReserve(sellingPriceCents, 50),
    supportCents: 50,
    fulfillmentCents: 100,
    acquisitionCents: acquisitionReserveCents,
  };

  const root = parseSpecifications(existingSpecifications);
  root.supplierOfferV1 = {
    supplierName,
    sourceClass: input.sourceClass,
    sourceUrl,
    resaleAllowed: true,
    sourceVerifiedAt: sourceVerifiedAt.toISOString(),
    priceVerifiedAt: priceVerifiedAt.toISOString(),
    inventoryConfidenceBps,
    availability: input.availability,
    costBreakdown: {
      itemCostCents,
      shippingCents,
      taxCents,
      supplierFeeCents,
      handlingCents,
      landedCostCents,
    },
  };
  root.commerceV1 = {
    sourceClass: input.sourceClass,
    resaleAllowed: true,
    sourceVerifiedAt: sourceVerifiedAt.toISOString(),
    maxSourceAgeDays: MAX_SOURCE_AGE_DAYS,
    maxPriceAgeMinutes: MAX_PRICE_AGE_MINUTES,
    inventoryConfidenceBps,
    minInventoryConfidenceBps: MIN_INVENTORY_CONFIDENCE_BPS,
    minContributionProfitCents: MIN_PROFIT_CENTS,
    minContributionMarginBps: MIN_MARGIN_BPS,
    reserves,
  };

  const specifications = JSON.stringify(root);
  const decision = evaluateCommerceGate(
    {
      commerceEnabled: true,
      availability: input.availability,
      sellingPriceCents,
      landedCostCents,
      priceVerifiedAt,
      specifications,
    },
    nowMs,
  );

  return {
    sellingPriceCents,
    landedCostCents,
    priceVerifiedAt,
    availability: input.availability,
    specifications,
    commerceEnabled: decision.allowed,
    decision,
  };
}
