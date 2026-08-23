import { assessCommerceEligibility, type CommerceEligibilityResult } from "@/lib/commerce-eligibility";
import type { PricingInput } from "@/lib/dynamic-pricing";

export const COMMERCE_SOURCE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const ACTIVATION_MIN_MARGIN_BPS = 1_500;
export const ACTIVATION_MIN_PROFIT_CENTS = 200;
export const ACTIVATION_MIN_PAYMENT_FEE_BPS = 300;
export const ACTIVATION_MIN_PAYMENT_FIXED_FEE_CENTS = 30;

const TRUSTED_PRICE_SOURCES = new Set(["amazon-creators-api"]);
const AVAILABLE_SOURCE_STATES = new Set(["in_stock", "now", "available"]);

type JsonRecord = Record<string, unknown>;
type RecommendationPricing = Omit<PricingInput, "landedCostCents">;

type RecommendationCosts = {
  item: number;
  shipping: number;
  estimatedTax: number;
  handling: number;
  procurementBuffer: number;
  other: number;
};

export type CommerceActivationProduct = {
  id: string;
  retailer: string;
  affiliateUrl: string;
  price: number;
  availability: string;
  specifications: string;
  lastUpdated: Date | string;
  commerceEnabled: boolean;
  landedCostCents: number | null;
  sellingPriceCents: number | null;
  currency: string;
};

export type SavedCommerceRecommendation = {
  assessedAt: string;
  savedByUserId: string;
  sourceCheckedAtMs: number;
  costs: RecommendationCosts;
  pricing: RecommendationPricing;
  landedCostCents: number;
  sellingPriceCents: number;
};

export type CurrentCommerceSource = {
  itemCostCents: number;
  priceSource: string | null;
  checkedAtMs: number;
  trusted: boolean;
  available: boolean;
  fresh: boolean;
  canonicalAvailability: "in_stock" | "unavailable";
  supplierRouteReady: boolean;
};

export type ActivationBlockReason =
  | "ELIGIBLE"
  | "BLOCKED_FINANCIAL_GATE"
  | "BLOCKED_NO_RECOMMENDATION"
  | "BLOCKED_SOURCE_UNVERIFIED"
  | "BLOCKED_SOURCE_UNAVAILABLE"
  | "BLOCKED_SOURCE_STALE"
  | "BLOCKED_SOURCE_CHANGED"
  | "BLOCKED_POLICY_FLOOR"
  | "BLOCKED_FINANCIAL_MISMATCH"
  | "BLOCKED_SUPPLIER_ROUTE"
  | "BLOCKED_PRICING";

export type CommerceActivationAssessment = {
  eligible: boolean;
  reason: ActivationBlockReason;
  recommendation: SavedCommerceRecommendation | null;
  source: CurrentCommerceSource;
  commerceAssessment: CommerceEligibilityResult | null;
};

function parseRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function parseSpecifications(value: string) {
  try {
    return parseRecord(JSON.parse(value) as unknown) ?? {};
  } catch {
    return {} as JsonRecord;
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function nonNegativeInteger(value: unknown) {
  const parsed = safeInteger(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function positiveInteger(value: unknown) {
  const parsed = safeInteger(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function timestampMs(value: unknown) {
  if (value instanceof Date) {
    const parsed = value.getTime();
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function catalogPriceCents(price: number) {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const scaled = price * 100;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || rounded <= 0 || Math.abs(scaled - rounded) > 1e-6) return 0;
  return rounded;
}

function amazonSupplierRouteReady(retailer: string, affiliateUrl: string, priceSource: string | null) {
  if (retailer.trim().toLowerCase() !== "amazon" || priceSource !== "amazon-creators-api") return false;
  try {
    const url = new URL(affiliateUrl);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "amazon.com" || host === "www.amazon.com" || host.endsWith(".amazon.com"));
  } catch {
    return false;
  }
}

function pricingFromRecord(value: unknown): RecommendationPricing | null {
  const record = parseRecord(value);
  if (!record) return null;
  const targetGrossMarginBps = nonNegativeInteger(record.targetGrossMarginBps);
  if (targetGrossMarginBps === null || targetGrossMarginBps > 9_999) return null;

  const optional = (key: string, positive = false) => {
    if (record[key] === undefined) return undefined;
    return positive ? positiveInteger(record[key]) : nonNegativeInteger(record[key]);
  };
  const minimumProfitCents = optional("minimumProfitCents");
  const paymentFeeBps = optional("paymentFeeBps");
  const paymentFixedFeeCents = optional("paymentFixedFeeCents");
  const priceFloorCents = optional("priceFloorCents");
  const priceCeilingCents = optional("priceCeilingCents", true);
  if (
    minimumProfitCents === null ||
    paymentFeeBps === null ||
    paymentFixedFeeCents === null ||
    priceFloorCents === null ||
    priceCeilingCents === null ||
    (paymentFeeBps !== undefined && paymentFeeBps > 9_999)
  ) return null;

  return {
    targetGrossMarginBps,
    ...(minimumProfitCents !== undefined ? { minimumProfitCents } : {}),
    ...(paymentFeeBps !== undefined ? { paymentFeeBps } : {}),
    ...(paymentFixedFeeCents !== undefined ? { paymentFixedFeeCents } : {}),
    ...(priceFloorCents !== undefined ? { priceFloorCents } : {}),
    ...(priceCeilingCents !== undefined ? { priceCeilingCents } : {}),
  };
}

export function readSavedCommerceRecommendation(specifications: string): SavedCommerceRecommendation | null {
  const specs = parseSpecifications(specifications);
  const recommendation = parseRecord(specs.commerceRecommendation);
  if (!recommendation || recommendation.status !== "owner_reviewed_recommendation") return null;
  if (recommendation.sourceVerified !== true || recommendation.sourceAvailable !== true) return null;

  const assessedAt = stringValue(recommendation.assessedAt);
  const savedByUserId = stringValue(recommendation.savedByUserId);
  const sourceCheckedAtMs = timestampMs(recommendation.sourceCheckedAt);
  const costsRecord = parseRecord(recommendation.costComponentsCents);
  const resultRecord = parseRecord(recommendation.result);
  const pricing = pricingFromRecord(recommendation.pricingPolicy);
  if (!assessedAt || !timestampMs(assessedAt) || !savedByUserId || !sourceCheckedAtMs || !costsRecord || !resultRecord || !pricing) return null;

  const item = positiveInteger(costsRecord.item);
  const shipping = nonNegativeInteger(costsRecord.shipping);
  const estimatedTax = nonNegativeInteger(costsRecord.estimatedTax);
  const handling = nonNegativeInteger(costsRecord.handling);
  const procurementBuffer = nonNegativeInteger(costsRecord.procurementBuffer);
  const other = nonNegativeInteger(costsRecord.other);
  const landedCostCents = positiveInteger(resultRecord.landedCostCents);
  const sellingPriceCents = positiveInteger(resultRecord.recommendedSellingPriceCents);
  if (
    item === null || shipping === null || estimatedTax === null || handling === null ||
    procurementBuffer === null || other === null || landedCostCents === null || sellingPriceCents === null
  ) return null;

  return {
    assessedAt,
    savedByUserId,
    sourceCheckedAtMs,
    costs: { item, shipping, estimatedTax, handling, procurementBuffer, other },
    pricing,
    landedCostCents,
    sellingPriceCents,
  };
}

export function deriveCurrentCommerceSource(product: CommerceActivationProduct, nowMs = Date.now()): CurrentCommerceSource {
  const specs = parseSpecifications(product.specifications);
  const priceSource = stringValue(specs.priceSource) || null;
  const metadataSource = stringValue(specs.metadataSource) || null;
  const checkedAtMs =
    timestampMs(specs.priceCheckedAt) ??
    timestampMs(specs.metadataCheckedAt) ??
    timestampMs(product.lastUpdated) ??
    0;
  const incomplete = specs.needsEnrichment === true || specs.storefrontBlocked === true;
  const trusted = Boolean(
    !incomplete &&
      priceSource &&
      TRUSTED_PRICE_SOURCES.has(priceSource) &&
      (!metadataSource || metadataSource === priceSource),
  );
  const available = AVAILABLE_SOURCE_STATES.has(product.availability.trim().toLowerCase());
  const fresh = Number.isSafeInteger(nowMs) && checkedAtMs > 0 && nowMs >= checkedAtMs && nowMs - checkedAtMs <= COMMERCE_SOURCE_MAX_AGE_MS;

  return {
    itemCostCents: catalogPriceCents(product.price),
    priceSource,
    checkedAtMs,
    trusted,
    available,
    fresh,
    canonicalAvailability: available ? "in_stock" : "unavailable",
    supplierRouteReady: amazonSupplierRouteReady(product.retailer, product.affiliateUrl, priceSource),
  };
}

function policyMeetsActivationFloor(pricing: RecommendationPricing) {
  return (
    pricing.targetGrossMarginBps >= ACTIVATION_MIN_MARGIN_BPS &&
    (pricing.minimumProfitCents ?? 0) >= ACTIVATION_MIN_PROFIT_CENTS &&
    (pricing.paymentFeeBps ?? 0) >= ACTIVATION_MIN_PAYMENT_FEE_BPS &&
    (pricing.paymentFixedFeeCents ?? 0) >= ACTIVATION_MIN_PAYMENT_FIXED_FEE_CENTS
  );
}

function blocked(reason: ActivationBlockReason, recommendation: SavedCommerceRecommendation | null, source: CurrentCommerceSource): CommerceActivationAssessment {
  return { eligible: false, reason, recommendation, source, commerceAssessment: null };
}

export function assessProductForActivation(input: {
  product: CommerceActivationProduct;
  financialGateCertified: boolean;
  nowMs?: number;
}): CommerceActivationAssessment {
  const nowMs = input.nowMs ?? Date.now();
  const recommendation = readSavedCommerceRecommendation(input.product.specifications);
  const source = deriveCurrentCommerceSource(input.product, nowMs);

  if (!input.financialGateCertified) return blocked("BLOCKED_FINANCIAL_GATE", recommendation, source);
  if (!recommendation) return blocked("BLOCKED_NO_RECOMMENDATION", null, source);
  if (!source.trusted || source.itemCostCents <= 0) return blocked("BLOCKED_SOURCE_UNVERIFIED", recommendation, source);
  if (!source.available) return blocked("BLOCKED_SOURCE_UNAVAILABLE", recommendation, source);
  if (!source.fresh) return blocked("BLOCKED_SOURCE_STALE", recommendation, source);
  if (!source.supplierRouteReady) return blocked("BLOCKED_SUPPLIER_ROUTE", recommendation, source);
  if (recommendation.sourceCheckedAtMs !== source.checkedAtMs || recommendation.costs.item !== source.itemCostCents) {
    return blocked("BLOCKED_SOURCE_CHANGED", recommendation, source);
  }
  if (!policyMeetsActivationFloor(recommendation.pricing)) return blocked("BLOCKED_POLICY_FLOOR", recommendation, source);
  if (
    input.product.currency.toLowerCase() !== "usd" ||
    input.product.landedCostCents !== recommendation.landedCostCents ||
    input.product.sellingPriceCents !== recommendation.sellingPriceCents
  ) {
    return blocked("BLOCKED_FINANCIAL_MISMATCH", recommendation, source);
  }

  const commerceAssessment = assessCommerceEligibility({
    financialGateCertified: true,
    landedCost: {
      itemCostCents: source.itemCostCents,
      shippingCents: recommendation.costs.shipping,
      estimatedTaxCents: recommendation.costs.estimatedTax,
      handlingCents: recommendation.costs.handling,
      procurementBufferCents: recommendation.costs.procurementBuffer,
      otherCostCents: recommendation.costs.other,
      sourceVerified: source.trusted,
      sourceAvailable: source.available,
      sourceCheckedAtMs: source.checkedAtMs,
      maxSourceAgeMs: COMMERCE_SOURCE_MAX_AGE_MS,
      nowMs,
    },
    pricing: recommendation.pricing,
  });
  if (
    !commerceAssessment.eligible ||
    commerceAssessment.landedCostCents !== recommendation.landedCostCents ||
    commerceAssessment.recommendedSellingPriceCents !== recommendation.sellingPriceCents
  ) {
    return { eligible: false, reason: "BLOCKED_PRICING", recommendation, source, commerceAssessment };
  }

  return { eligible: true, reason: "ELIGIBLE", recommendation, source, commerceAssessment };
}

export function activationAuditSpecifications(input: {
  specifications: string;
  activatedAt: string;
  activatedByUserId: string;
  assessment: CommerceActivationAssessment;
  fulfillmentMode: "manual_supplier_purchase";
}) {
  const specs = parseSpecifications(input.specifications);
  return JSON.stringify({
    ...specs,
    commerceActivation: {
      state: "active",
      activatedAt: input.activatedAt,
      activatedByUserId: input.activatedByUserId,
      fulfillmentMode: input.fulfillmentMode,
      sourcePriceCents: input.assessment.source.itemCostCents,
      sourceCheckedAt: new Date(input.assessment.source.checkedAtMs).toISOString(),
      priceSource: input.assessment.source.priceSource,
      recommendationAssessedAt: input.assessment.recommendation?.assessedAt ?? null,
      landedCostCents: input.assessment.recommendation?.landedCostCents ?? null,
      sellingPriceCents: input.assessment.recommendation?.sellingPriceCents ?? null,
    },
  });
}

export function disabledActivationSpecifications(specifications: string, disabledAt: string, disabledByUserId: string) {
  const specs = parseSpecifications(specifications);
  const prior = parseRecord(specs.commerceActivation) ?? {};
  return JSON.stringify({
    ...specs,
    commerceActivation: {
      ...prior,
      state: "disabled",
      disabledAt,
      disabledByUserId,
    },
  });
}
