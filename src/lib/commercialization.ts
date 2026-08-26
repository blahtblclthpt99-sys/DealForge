import { type CartPricingPolicy, calculateMinimumSafeCustomerPrice, currentCartPricingPolicy, minimumSafeProfitCents } from "@/lib/cart-pricing";
import { evaluateCommerceGate, type CommerceGateDecision } from "@/lib/commerce-gate";
import { DIRECT_RESALE_SOURCE_CLASSES, isDirectResaleSourceClass, type DirectResaleSourceClass } from "@/lib/source-policy";

export { DIRECT_RESALE_SOURCE_CLASSES };
export type { DirectResaleSourceClass };

export const CANONICAL_PRICING_POLICY_VERSION = "minimum-safe-profit-v2";
export const MIN_PROFIT_CENTS = 0;
export const MIN_MARGIN_BPS = 0;
export const MIN_INVENTORY_CONFIDENCE_BPS = 8000;
export const MAX_SOURCE_AGE_DAYS = 30;
export const MAX_PRICE_AGE_MINUTES = 180;
export const DEFAULT_TAX_CLASSIFICATION_MAX_AGE_DAYS = 365;

type CostInput = {
  itemCostCents: number;
  shippingCents: number;
  taxCents: number;
  supplierFeeCents: number;
  handlingCents: number;
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
  taxClassification: string;
  stripeTaxCode: string;
  taxVerifiedAt: string;
  taxVerificationSource: string;
  taxMaxAgeDays?: number;
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

function positive(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field.toUpperCase()}_INVALID`);
  return value;
}

function nonNegative(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field.toUpperCase()}_INVALID`);
  return value;
}

function bps(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) throw new Error(`${field.toUpperCase()}_INVALID`);
  return value;
}

function timestamp(value: string, field: string, nowMs: number) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${field.toUpperCase()}_INVALID`);
  if (ms > nowMs + 5 * 60_000) throw new Error(`${field.toUpperCase()}_IN_FUTURE`);
  return new Date(ms);
}

function boundedTaxMaxAgeDays(value: number | undefined) {
  const resolved = value ?? DEFAULT_TAX_CLASSIFICATION_MAX_AGE_DAYS;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > 3650) {
    throw new Error("TAX_MAX_AGE_DAYS_INVALID");
  }
  return resolved;
}

function taxText(value: string, field: string, max: number) {
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > max) throw new Error(`${field.toUpperCase()}_INVALID`);
  return cleaned;
}

function stripeTaxCode(value: string) {
  const cleaned = value.trim();
  if (!/^txcd_[A-Za-z0-9]+$/.test(cleaned)) throw new Error("STRIPE_TAX_CODE_INVALID");
  return cleaned;
}

function sourceUrl(value: string | null | undefined) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("SOURCE_URL_HTTPS_REQUIRED");
  if (url.username || url.password) throw new Error("SOURCE_URL_CREDENTIALS_NOT_ALLOWED");
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" || host === "127.0.0.1" || host === "::1" ||
    host.endsWith(".local") || host.endsWith(".internal") || /^10\./.test(host) ||
    /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) throw new Error("SOURCE_URL_PRIVATE_HOST");
  return url.toString().slice(0, 2000);
}

function parseSpecifications(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Malformed legacy metadata is replaced; commerce evaluation still fails closed.
  }
  return {} as Record<string, unknown>;
}

function costs(input: CostInput) {
  const itemCostCents = positive(input.itemCostCents, "item_cost_cents");
  const shippingCents = nonNegative(input.shippingCents, "shipping_cents");
  const taxCents = nonNegative(input.taxCents, "tax_cents");
  const supplierFeeCents = nonNegative(input.supplierFeeCents, "supplier_fee_cents");
  const handlingCents = nonNegative(input.handlingCents, "handling_cents");
  const acquisitionReserveCents = nonNegative(input.acquisitionReserveCents, "acquisition_reserve_cents");
  const landedCostCents = itemCostCents + shippingCents + taxCents + supplierFeeCents + handlingCents;
  if (!Number.isSafeInteger(landedCostCents) || landedCostCents <= 0) throw new Error("LANDED_COST_INVALID");
  if (!Number.isSafeInteger(landedCostCents + acquisitionReserveCents)) throw new Error("PRICING_BASIS_INVALID");
  return { itemCostCents, shippingCents, taxCents, supplierFeeCents, handlingCents, acquisitionReserveCents, landedCostCents };
}

function percentageCost(amountCents: number, basisPoints: number) {
  return Math.ceil((amountCents * basisPoints) / 10_000);
}

export function buildReserves(
  sellingPriceCents: number,
  acquisitionReserveCents: number,
  policy: CartPricingPolicy = currentCartPricingPolicy(),
): CanonicalReserves {
  positive(sellingPriceCents, "selling_price_cents");
  nonNegative(acquisitionReserveCents, "acquisition_reserve_cents");
  return {
    paymentCents: percentageCost(sellingPriceCents, policy.paymentRateBps) + policy.paymentFixedCents,
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
  input: CostInput & { marketReferenceCents?: number | null; maxMarketPremiumBps?: number },
  pricingPolicy: CartPricingPolicy = currentCartPricingPolicy(),
): CommercialPriceRecommendation {
  const c = costs(input);
  const safe = calculateMinimumSafeCustomerPrice({
    landedCostCents: c.landedCostCents,
    attributableCostCents: c.acquisitionReserveCents,
    policy: pricingPolicy,
  });
  const recommendedPriceCents = safe.customerPriceCents;
  const reserves = buildReserves(recommendedPriceCents, c.acquisitionReserveCents, pricingPolicy);
  const total = reserveTotal(reserves);
  const contributionProfitCents = recommendedPriceCents - c.landedCostCents - total;
  const contributionMarginBps = Math.floor((contributionProfitCents * 10_000) / recommendedPriceCents);

  let marketCeilingCents: number | null = null;
  let marketCompatible = true;
  const reasons: string[] = [];
  if (input.marketReferenceCents !== null && input.marketReferenceCents !== undefined) {
    const reference = positive(input.marketReferenceCents, "market_reference_cents");
    const premium = bps(input.maxMarketPremiumBps ?? 1500, "max_market_premium_bps");
    marketCeilingCents = Math.floor((reference * (10_000 + premium)) / 10_000);
    if (recommendedPriceCents > marketCeilingCents) {
      marketCompatible = false;
      reasons.push("safe_price_exceeds_market_ceiling");
    }
  }
  if (contributionProfitCents < safe.minimumProfitCents) reasons.push("profit_floor_not_met");

  return {
    recommendedPriceCents,
    minimumSafePriceCents: safe.minimumSafePriceCents,
    contributionProfitCents,
    contributionMarginBps,
    marketCeilingCents,
    marketCompatible,
    reasons,
    landedCostCents: c.landedCostCents,
    reserveTotalCents: total,
    reserves,
    minimumProfitCents: safe.minimumProfitCents,
    pricingPolicyVersion: CANONICAL_PRICING_POLICY_VERSION,
  };
}

export function isInternalCertificationSpecifications(specifications: string) {
  return parseSpecifications(specifications).internalCertification === true;
}

export function prepareCommercialization(
  existingSpecifications: string,
  input: CommercializationInput,
  nowMs = Date.now(),
  pricingPolicy: CartPricingPolicy = currentCartPricingPolicy(),
): PreparedCommercialization {
  if (isInternalCertificationSpecifications(existingSpecifications)) throw new Error("CERTIFICATION_PRODUCT_IMMUTABLE");

  const supplierName = input.supplierName.trim();
  if (supplierName.length < 2 || supplierName.length > 160) throw new Error("SUPPLIER_NAME_INVALID");
  if (!isDirectResaleSourceClass(input.sourceClass)) throw new Error("SOURCE_CLASS_INVALID");
  if (input.resaleAllowed !== true) throw new Error("RESALE_AUTHORIZATION_REQUIRED");

  const verifiedSourceUrl = sourceUrl(input.sourceUrl);
  const sourceVerifiedAt = timestamp(input.sourceVerifiedAt, "source_verified_at", nowMs);
  const priceVerifiedAt = timestamp(input.priceVerifiedAt, "price_verified_at", nowMs);
  const taxVerifiedAt = timestamp(input.taxVerifiedAt, "tax_verified_at", nowMs);
  const taxMaxAgeDays = boundedTaxMaxAgeDays(input.taxMaxAgeDays);
  if (nowMs - taxVerifiedAt.getTime() > taxMaxAgeDays * 86_400_000) {
    throw new Error("TAX_CLASSIFICATION_STALE");
  }
  const taxClassification = taxText(input.taxClassification, "tax_classification", 160);
  const verifiedStripeTaxCode = stripeTaxCode(input.stripeTaxCode);
  const taxVerificationSource = taxText(input.taxVerificationSource, "tax_verification_source", 160);

  const c = costs(input);
  const sellingPriceCents = positive(input.sellingPriceCents, "selling_price_cents");
  const inventoryConfidenceBps = bps(input.inventoryConfidenceBps, "inventory_confidence_bps");
  const reserves = buildReserves(sellingPriceCents, c.acquisitionReserveCents, pricingPolicy);
  const minimumProfitCents = minimumSafeProfitCents(c.landedCostCents);

  const root = parseSpecifications(existingSpecifications);
  root.taxV1 = {
    stripeTaxCode: verifiedStripeTaxCode,
    classification: taxClassification,
    verifiedAt: taxVerifiedAt.toISOString(),
    verificationSource: taxVerificationSource,
    maxAgeDays: taxMaxAgeDays,
  };
  root.supplierOfferV1 = {
    supplierName,
    sourceClass: input.sourceClass,
    sourceUrl: verifiedSourceUrl,
    resaleAllowed: true,
    sourceVerifiedAt: sourceVerifiedAt.toISOString(),
    priceVerifiedAt: priceVerifiedAt.toISOString(),
    inventoryConfidenceBps,
    availability: input.availability,
    costBreakdown: {
      itemCostCents: c.itemCostCents,
      shippingCents: c.shippingCents,
      taxCents: c.taxCents,
      supplierFeeCents: c.supplierFeeCents,
      handlingCents: c.handlingCents,
      landedCostCents: c.landedCostCents,
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
    attributableAcquisitionCostCents: c.acquisitionReserveCents,
    minimumProfitCents,
    rounding: "next_49_or_99_only",
    publishedPriceBehavior: "ceiling_never_auto_raise_at_cart",
    marketBehavior: "pause_or_reprice_source_when_safe_price_exceeds_verified_market",
  };

  const specifications = JSON.stringify(root);
  const decision = evaluateCommerceGate({
    commerceEnabled: true,
    availability: input.availability,
    sellingPriceCents,
    landedCostCents: c.landedCostCents,
    priceVerifiedAt,
    specifications,
  }, nowMs);

  return {
    sellingPriceCents,
    landedCostCents: c.landedCostCents,
    priceVerifiedAt,
    availability: input.availability,
    specifications,
    commerceEnabled: decision.allowed,
    decision,
  };
}
