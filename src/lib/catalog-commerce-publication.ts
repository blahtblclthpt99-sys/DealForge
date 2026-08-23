import { assessCommerceEligibility, type CommerceEligibilityResult } from "@/lib/commerce-eligibility";
import type { PricingInput } from "@/lib/dynamic-pricing";

export const DEFAULT_CATALOG_SOURCE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const MIN_PUBLICATION_MARGIN_BPS = 1_500;
export const MIN_PUBLICATION_PROFIT_CENTS = 200;
export const MIN_PUBLICATION_PAYMENT_FEE_BPS = 300;
export const MIN_PUBLICATION_PAYMENT_FIXED_FEE_CENTS = 30;

const TRUSTED_PRICE_SOURCES = new Set(["amazon-creators-api"]);
const AVAILABLE_SOURCE_STATES = new Set(["in_stock", "now", "available"]);

type JsonRecord = Record<string, unknown>;
type PublicationPricingInput = Omit<PricingInput, "landedCostCents">;

export type CatalogPublicationProduct = {
  id: string;
  price: number;
  availability: string;
  specifications: string;
  lastUpdated: Date | string;
};

export type PublicationCostPolicy = {
  shippingCents: number;
  estimatedTaxCents: number;
  handlingCents: number;
  procurementBufferCents: number;
  otherCostCents: number;
};

export type CatalogSourceSnapshot = {
  itemCostCents: number;
  sourceVerified: boolean;
  sourceAvailable: boolean;
  sourceCheckedAtMs: number;
  maxSourceAgeMs: number;
  priceSource: string | null;
  canonicalAvailability: "in_stock" | "unavailable";
};

export type CatalogPublicationAssessment = {
  source: CatalogSourceSnapshot;
  effectivePricing: PublicationPricingInput;
  assessment: CommerceEligibilityResult;
};

function parseSpecifications(value: string): JsonRecord {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as JsonRecord)
      : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

export function publicationPricingPolicy(pricing: PublicationPricingInput): PublicationPricingInput {
  return {
    ...pricing,
    targetGrossMarginBps: Math.max(pricing.targetGrossMarginBps, MIN_PUBLICATION_MARGIN_BPS),
    minimumProfitCents: Math.max(pricing.minimumProfitCents ?? 0, MIN_PUBLICATION_PROFIT_CENTS),
    paymentFeeBps: Math.max(pricing.paymentFeeBps ?? 0, MIN_PUBLICATION_PAYMENT_FEE_BPS),
    paymentFixedFeeCents: Math.max(
      pricing.paymentFixedFeeCents ?? 0,
      MIN_PUBLICATION_PAYMENT_FIXED_FEE_CENTS,
    ),
  };
}

export function deriveCatalogSourceSnapshot(
  product: CatalogPublicationProduct,
  maxSourceAgeMs = DEFAULT_CATALOG_SOURCE_MAX_AGE_MS,
): CatalogSourceSnapshot {
  const specs = parseSpecifications(product.specifications);
  const priceSource = stringValue(specs.priceSource) || null;
  const metadataSource = stringValue(specs.metadataSource) || null;
  const checkedAt =
    timestampMs(specs.priceCheckedAt) ??
    timestampMs(specs.metadataCheckedAt) ??
    timestampMs(product.lastUpdated) ??
    0;
  const availability = product.availability.trim().toLowerCase();
  const sourceAvailable = AVAILABLE_SOURCE_STATES.has(availability);
  const incomplete = specs.needsEnrichment === true || specs.storefrontBlocked === true;
  const sourceVerified = Boolean(
    !incomplete &&
      priceSource &&
      TRUSTED_PRICE_SOURCES.has(priceSource) &&
      (!metadataSource || metadataSource === priceSource),
  );

  return {
    itemCostCents: catalogPriceCents(product.price),
    sourceVerified,
    sourceAvailable,
    sourceCheckedAtMs: checkedAt,
    maxSourceAgeMs,
    priceSource,
    canonicalAvailability: sourceAvailable ? "in_stock" : "unavailable",
  };
}

export function assessCatalogProductForPublication(input: {
  financialGateCertified: boolean;
  product: CatalogPublicationProduct;
  costs: PublicationCostPolicy;
  pricing: PublicationPricingInput;
  nowMs?: number;
  maxSourceAgeMs?: number;
}): CatalogPublicationAssessment {
  const source = deriveCatalogSourceSnapshot(
    input.product,
    input.maxSourceAgeMs ?? DEFAULT_CATALOG_SOURCE_MAX_AGE_MS,
  );
  const effectivePricing = publicationPricingPolicy(input.pricing);
  const assessment = assessCommerceEligibility({
    financialGateCertified: input.financialGateCertified,
    landedCost: {
      itemCostCents: source.itemCostCents,
      shippingCents: input.costs.shippingCents,
      estimatedTaxCents: input.costs.estimatedTaxCents,
      handlingCents: input.costs.handlingCents,
      procurementBufferCents: input.costs.procurementBufferCents,
      otherCostCents: input.costs.otherCostCents,
      sourceVerified: source.sourceVerified,
      sourceAvailable: source.sourceAvailable,
      sourceCheckedAtMs: source.sourceCheckedAtMs,
      maxSourceAgeMs: source.maxSourceAgeMs,
      nowMs: input.nowMs,
    },
    pricing: effectivePricing,
  });
  return { source, effectivePricing, assessment };
}

export function publicationAuditSpecifications(input: {
  existingSpecifications: string;
  publishedAt: string;
  source: CatalogSourceSnapshot;
  assessment: CommerceEligibilityResult;
  costs: PublicationCostPolicy;
  pricing: PublicationPricingInput;
}) {
  const specs = parseSpecifications(input.existingSpecifications);
  return JSON.stringify({
    ...specs,
    commercePublication: {
      state: "published",
      publishedAt: input.publishedAt,
      sourcePriceCents: input.source.itemCostCents,
      sourcePriceCheckedAt: new Date(input.source.sourceCheckedAtMs).toISOString(),
      priceSource: input.source.priceSource,
      profitabilityScore: input.assessment.profitabilityScore,
      profitabilityTier: input.assessment.profitabilityTier,
      estimatedProfitCents: input.assessment.estimatedProfitCents,
      grossMarginBps: input.assessment.grossMarginBps,
      costs: input.costs,
      pricing: input.pricing,
    },
  });
}

export function disabledPublicationSpecifications(existingSpecifications: string, disabledAt: string) {
  const specs = parseSpecifications(existingSpecifications);
  const prior =
    typeof specs.commercePublication === "object" && specs.commercePublication !== null && !Array.isArray(specs.commercePublication)
      ? (specs.commercePublication as JsonRecord)
      : {};
  return JSON.stringify({
    ...specs,
    commercePublication: {
      ...prior,
      state: "disabled",
      disabledAt,
    },
  });
}
