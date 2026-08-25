import { evaluateCommerceGate, type CommerceGateDecision } from "@/lib/commerce-gate";
import {
  calculateMinimumSafeCustomerPrice,
  currentCartPricingPolicy,
  minimumSafeProfitCents,
  type CartPricingPolicy,
} from "@/lib/cart-pricing";
import {
  DIRECT_RESALE_SOURCE_CLASSES,
  isDirectResaleSourceClass,
  type DirectResaleSourceClass,
} from "@/lib/source-policy";

export { DIRECT_RESALE_SOURCE_CLASSES };
export type { DirectResaleSourceClass };

export const CANONICAL_PRICING_POLICY_VERSION = "minimum-safe-profit-v2";

type CostInput = {
  itemCostCents: number;
  shippingCents: number;
  taxCents: number;
  supplierFeeCents: number;
  handlingCents: number;
  /**
   * Backward-compatible field name. V2 treats this only as an explicitly
   * attributable per-order acquisition cost, never as a generic padding bucket.
   */
  acquisitionReserveCents: number;
};

export type CommercializationInput = CostInput & {
  supplierName: string;
  sourceClass: DirectResaleSourceClass;
  sourceUrl?: string | null;
  resaleAllowed: true;
  sourceVerifiedAt: string;
  priceVerifiedAt: string;
  sellingPriceCents: number;
  inventoryConfidenceBps: number;
  availability: "in_stock" | "out_of_stock" | "unknown";
};

type CanonicalReserves = {
  paymentCents: number;
  returnsCents: number;
  chargebackCents: number;
  fraudCents: number;
  supportCents: number;
  fulfillmentCents: number;
  acquisitionCents: number;
};

export type CommercialPriceRecommendation = {
  recommendedPriceCents: number;
  minimumSafePriceCents: number;
  contributionProfitCents: number;
  contributionMarginBps: number;
  marketCeilingCents: number | null;
  marketCompatible: boolean;
  reasons: string[];
  landedCostCents: number;
  reserveTotalCents: number;
  reserves: CanonicalReserves;
  minimumProfitCents: number;
  pricingPolicyVersion: typeof CANONICAL_PRICING_POLICY_VERSION;
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

// Kept for compatibility with callers/tests that imported the previous constants.
// V2 uses the tiered fixed-dollar-or-percentage profit table instead of one global floor.
export const MIN_PROFIT_CENTS = 0;
export const MIN_MARGIN_BPS = 0;
export const MIN_INVENTORY_CONFIDENCE_BPS = 8000;
export const MAX_SOURCE_AGE_DAYS = 30;
export const MAX_PRICE_AGE_MINUTES = 180;

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

function percentageCost(amountCents: number, basisPoints: number) {
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

function validatedCosts(input: CostInput) {
  const itemCostCents = safePositiveInteger(input.itemCostCents, "item_cost_cents");
  const shippingCents = safeNonNegativeInteger(input.shippingCents, "shipping_cents");
  const taxCents = safeNonNegativeInteger(input.taxCents, "tax_cents");
  const supplierFeeCents = safeNonNegativeInteger(input.supplierFeeCents, "supplier_fee_cents");
  const handlingCents = safeNonNegativeInteger(input.handlingCents, "handling_cents");
  const acquisitionReserveCents = safeNonNegativeInteger(input.acquisitionReserveCents, "acquisition_reserve_cents");
  const landedCostCents = itemCostCents + shippingCents + taxCents + supplierFeeCents + handlingCents;
  if (!Number.isSafeInteger(landedCostCents) || landedCostCents <= 0) throw new Error("LANDED_COST_INVALID");
  const pricingBasisCents = landedCostCents + acquisitionReserveCents;
  if (!Number.isSafeInteger(pricingBasisCents) || pricingBasisCents <= 0) throw new Error("PRICING_BASIS_INVALID");
  return {
    itemCostCents,
    shippingCents,
    taxCents,
    supplierFeeCents,
    handlingCents,
    acquisitionReserveCents,
    landedCostCents,
    pricingBasisCents,
  };
}

/**
 * Backward-compatible reserve shape for commerceV1. In canonical V2 only the
 * payment-cost estimate, pooled loss reserve, and an explicitly supplied
 * attributable acquisition cost are non-zero. The old stacked return,
 * chargeback, fraud, support, and fulfillment padding is not carried forward.
 */
export function buildReserves(
  sellingPriceCents: number,
  acquisitionReserveCents: number,
  policy: CartPricingPolicy = currentCartPricingPolicy(),
): CanonicalReserves {
  safePositiveInteger(sellingPriceCents, "selling_price_cents");
  safeNonNegativeInteger(acquisitionReserveCents, "acquisition_reserve_cents");
  return {
    paymentCents: percentageCost(sellingPriceCents, policy.paymentRateBps) + policy.paymentFixedCents,
    // commerceV1's historical `returnsCents` slot is used only as a compatibility
    // carrier for the single pooled monthly loss reserve. commerceV2 names it correctly.
    returnsCents: percentageCost(sellingPriceCents, policy.lossReserveBps),
    chargebackCents: 0,
    fraudCents: 0,
    supportCents: 0,
    fulfillmentCents: 0,
    acquisitionCents: acquisitionReserveCents,
  };
}

function reserveTotal(reserves: CanonicalReserves) {
  const total = Object.values(reserves).reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total) || total < 0) throw new Error("RESERVE_TOTAL_INVALID");
  return total;
}

export function recommendCommercialPrice(
  input: CostInput & {
    marketReferenceCents?: number | null;
    maxMarketPremiumBps?: number;
  },
): CommercialPriceRecommendation {
  const costs = validatedCosts(input);
  const policy = currentCartPricingPolicy();
  const safePrice = calculateMinimumSafeCustomerPrice({
    landedCostCents: costs.landedCostCents,
    attributableCostCents: costs.acquisitionReserveCents,
    policy,
  });
  const recommendedPriceCents = safePrice.customerPriceCents;
  const reserves = buildReserves(recommendedPriceCents, costs.acquisitionReserveCents, policy);
  const total = reserveTotal(reserves);
  const contributionProfitCents = recommendedPriceCents - costs.landedCostCents - total;
  const contributionMarginBps = Math.floor((contributionProfitCents * 10_000) / recommendedPriceCents);

  let marketCeilingCents: number | null = null;
  let marketCompatible = true;
  const reasons: string[] = [];
  if (input.marketReferenceCents !== null && input.marketReferenceCents !== undefined) {
    const marketReference = safePositiveInteger(input.marketReferenceCents, "market_reference_cents");
    const maxPremiumBps = safeBasisPoints(input.maxMarketPremiumBps ?? 1500, "max_market_premium_bps");
    marketCeilingCents = Math.floor((marketReference * (10_000 + maxPremiumBps)) / 10_000);
    if (recommendedPriceCents > marketCeilingCents) {
      marketCompatible = false;
      reasons.push("safe_price_exceeds_market_ceiling");
    }
  }

  if (contributionProfitCents < safePrice.minimumProfitCents) {
    reasons.push("profit_floor_not_met");
  }

  return {
    recommendedPriceCents,
    minimumSafePriceCents: safePrice.minimumSafePriceCents,
    contributionProfitCents,
    contributionMarginBps,
    marketCeilingCents,
    marketCompatible,
    reasons,
    landedCostCents: costs.landedCostCents,
    reserveTotalCents: total,
    reserves,
    minimumProfitCents: safePrice.minimumProfitCents,
    pricingPolicyVersion: CANONICAL_PRICING_POLICY_VERSION,
  };
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
  if (!isDirectResaleSourceClass(input.sourceClass)) throw new Error("SOURCE_CLASS_INVALID");
  if (input.resaleAllowed !== true) throw new Error("RESALE_AUTHORIZATION_REQUIRED");

  const sourceUrl = safeSourceUrl(input.sourceUrl);
  const sourceVerifiedAt = safeTimestamp(input.sourceVerifiedAt, "source_verified_at", nowMs);
  const priceVerifiedAt = safeTimestamp(input.priceVerifiedAt, "price_verified_at", nowMs);
  const costs = validatedCosts(input);
  const sellingPriceCents = safePositiveInteger(input.sellingPriceCents, "selling_price_cents");
  const inventoryConfidenceBps = safeBasisPoints(input.inventoryConfidenceBps, "inventory_confidence_bps");
  const pricingPolicy = currentCartPricingPolicy();
  const reserves = buildReserves(sellingPriceCents, costs.acquisitionReserveCents, pricingPolicy);
  const minimumProfitCents = minimumSafeProfitCents(costs.pricingBasisCents);

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
      itemCostCents: costs.itemCostCents,
      shippingCents: costs.shippingCents,
      taxCents: costs.taxCents,
      supplierFeeCents: costs.supplierFeeCents,
      handlingCents: costs.handlingCents,
      landedCostCents: costs.landedCostCents,
    },
  };

  // Keep commerceV1 populated so existing gate/read paths remain compatible.
  // The values now mirror the canonical policy instead of the legacy stacked reserves.
  root.commerceV1 = {
    sourceClass: input.sourceClass,
    resaleAllowed: true,
    sourceVerifiedAt: sourceVerifiedAt.toISOString(),
    maxSourceAgeDays: MAX_SOURCE_AGE_DAYS,
    maxPriceAgeMinutes: MAX_PRICE_AGE_MINUTES,
    inventoryConfidenceBps,
    minInventoryConfidenceBps: MIN_INVENTORY_CONFIDENCE_BPS,
    minContributionProfitCents: minimumProfitCents,
    minContributionMarginBps: 0,
    reserves,
  };

  root.commerceV2 = {
    pricingPolicyVersion: CANONICAL_PRICING_POLICY_VERSION,
    paymentRateBps: pricingPolicy.paymentRateBps,
    paymentFixedCents: pricingPolicy.paymentFixedCents,
    lossReserveBps: pricingPolicy.lossReserveBps,
    maximumLossReserveBps: 200,
    attributableAcquisitionCostCents: costs.acquisitionReserveCents,
    minimumProfitCents,
    rounding: "next_49_or_99_only",
    publishedPriceBehavior: "ceiling_never_auto_raise_at_cart",
    marketBehavior: "pause_or_reprice_source_when_safe_price_exceeds_verified_market",
  };

  const specifications = JSON.stringify(root);
  const decision = evaluateCommerceGate(
    {
      commerceEnabled: true,
      availability: input.availability,
      sellingPriceCents,
      landedCostCents: costs.landedCostCents,
      priceVerifiedAt,
      specifications,
    },
    nowMs,
  );

  return {
    sellingPriceCents,
    landedCostCents: costs.landedCostCents,
    priceVerifiedAt,
    availability: input.availability,
    specifications,
    commerceEnabled: decision.allowed,
    decision,
  };
}
