import assert from "node:assert/strict";
import test from "node:test";
import { assessCommerceEligibility } from "../src/lib/commerce-eligibility";
import {
  activationAuditSpecifications,
  assessProductForActivation,
  disabledActivationSpecifications,
  type CommerceActivationProduct,
} from "../src/lib/commerce-activation";

const NOW = Date.parse("2026-08-23T02:40:00.000Z");
const CHECKED_AT = "2026-08-23T02:35:00.000Z";

const STRONG_PRICING = {
  targetGrossMarginBps: 2_000,
  minimumProfitCents: 300,
  paymentFeeBps: 300,
  paymentFixedFeeCents: 30,
  priceCeilingCents: 5_000,
};

const COSTS = {
  item: 1_025,
  shipping: 125,
  estimatedTax: 90,
  handling: 35,
  procurementBuffer: 50,
  other: 0,
};

function recommendationFor(input: {
  checkedAt?: string;
  pricing?: typeof STRONG_PRICING;
  costs?: typeof COSTS;
} = {}) {
  const checkedAt = input.checkedAt ?? CHECKED_AT;
  const pricing = input.pricing ?? STRONG_PRICING;
  const costs = input.costs ?? COSTS;
  const assessedAt = Date.parse(checkedAt) + 60_000;
  const assessment = assessCommerceEligibility({
    financialGateCertified: true,
    landedCost: {
      itemCostCents: costs.item,
      shippingCents: costs.shipping,
      estimatedTaxCents: costs.estimatedTax,
      handlingCents: costs.handling,
      procurementBufferCents: costs.procurementBuffer,
      otherCostCents: costs.other,
      sourceVerified: true,
      sourceAvailable: true,
      sourceCheckedAtMs: Date.parse(checkedAt),
      maxSourceAgeMs: 6 * 60 * 60 * 1000,
      nowMs: assessedAt,
    },
    pricing,
  });
  assert.equal(assessment.eligible, true);
  assert.notEqual(assessment.landedCostCents, null);
  assert.notEqual(assessment.recommendedSellingPriceCents, null);

  return {
    status: "owner_reviewed_recommendation",
    assessedAt: new Date(assessedAt).toISOString(),
    savedByUserId: "owner-1",
    sourceCheckedAt: checkedAt,
    sourceVerified: true,
    sourceAvailable: true,
    maxSourceAgeMs: 6 * 60 * 60 * 1000,
    costComponentsCents: costs,
    pricingPolicy: pricing,
    result: {
      landedCostCents: assessment.landedCostCents,
      recommendedSellingPriceCents: assessment.recommendedSellingPriceCents,
      estimatedPaymentFeeCents: assessment.estimatedPaymentFeeCents,
      estimatedProfitCents: assessment.estimatedProfitCents,
      grossMarginBps: assessment.grossMarginBps,
      profitabilityScore: assessment.profitabilityScore,
      profitabilityTier: assessment.profitabilityTier,
    },
  };
}

function product(input: {
  checkedAt?: string;
  price?: number;
  availability?: string;
  affiliateUrl?: string;
  priceSource?: string;
  recommendation?: ReturnType<typeof recommendationFor> | null;
  pricing?: typeof STRONG_PRICING;
  costs?: typeof COSTS;
  landedCostCents?: number | null;
  sellingPriceCents?: number | null;
  currency?: string;
  commerceEnabled?: boolean;
} = {}): CommerceActivationProduct {
  const checkedAt = input.checkedAt ?? CHECKED_AT;
  const recommendation = input.recommendation === undefined
    ? recommendationFor({ checkedAt, pricing: input.pricing, costs: input.costs })
    : input.recommendation;
  const specifications = {
    needsEnrichment: false,
    storefrontBlocked: false,
    metadataSource: input.priceSource ?? "amazon-creators-api",
    metadataCheckedAt: checkedAt,
    priceSource: input.priceSource ?? "amazon-creators-api",
    priceCheckedAt: checkedAt,
    ...(recommendation ? { commerceRecommendation: recommendation } : {}),
  };
  return {
    id: "product-1",
    retailer: "amazon",
    affiliateUrl: input.affiliateUrl ?? "https://www.amazon.com/dp/B000000001?tag=titanfieldos-20",
    price: input.price ?? 10.25,
    availability: input.availability ?? "now",
    specifications: JSON.stringify(specifications),
    lastUpdated: checkedAt,
    commerceEnabled: input.commerceEnabled ?? false,
    landedCostCents: input.landedCostCents === undefined
      ? recommendation?.result.landedCostCents ?? null
      : input.landedCostCents,
    sellingPriceCents: input.sellingPriceCents === undefined
      ? recommendation?.result.recommendedSellingPriceCents ?? null
      : input.sellingPriceCents,
    currency: input.currency ?? "usd",
  };
}

function parseRecord(value: string) {
  const parsed = JSON.parse(value) as unknown;
  assert.equal(typeof parsed, "object");
  assert.notEqual(parsed, null);
  assert.equal(Array.isArray(parsed), false);
  return parsed as Record<string, unknown>;
}

function nestedRecord(value: unknown) {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

test("activates only when the current trusted source exactly matches the saved recommendation", () => {
  const result = assessProductForActivation({ product: product(), financialGateCertified: true, nowMs: NOW });
  assert.equal(result.eligible, true);
  assert.equal(result.reason, "ELIGIBLE");
  assert.equal(result.source.canonicalAvailability, "in_stock");
  assert.equal(result.source.supplierRouteReady, true);
  assert.equal(result.commerceAssessment?.eligible, true);
});

test("financial certification remains a hard activation gate", () => {
  const result = assessProductForActivation({ product: product(), financialGateCertified: false, nowMs: NOW });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "BLOCKED_FINANCIAL_GATE");
});

test("a saved recommendation is mandatory", () => {
  const result = assessProductForActivation({
    product: product({ recommendation: null, landedCostCents: null, sellingPriceCents: null }),
    financialGateCertified: true,
    nowMs: NOW,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "BLOCKED_NO_RECOMMENDATION");
});

test("untrusted catalog price sources cannot activate commerce", () => {
  const result = assessProductForActivation({
    product: product({ priceSource: "user-batch" }),
    financialGateCertified: true,
    nowMs: NOW,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "BLOCKED_SOURCE_UNVERIFIED");
});

test("stale source data cannot remain activation-eligible", () => {
  const checkedAt = "2026-08-22T19:00:00.000Z";
  const result = assessProductForActivation({
    product: product({ checkedAt }),
    financialGateCertified: true,
    nowMs: NOW,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "BLOCKED_SOURCE_STALE");
});

test("source price changes require recommendation re-assessment", () => {
  const result = assessProductForActivation({
    product: product({ price: 10.50 }),
    financialGateCertified: true,
    nowMs: NOW,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "BLOCKED_SOURCE_CHANGED");
});

test("source timestamp changes require recommendation re-assessment", () => {
  const recommendation = recommendationFor();
  const newerCheckedAt = "2026-08-23T02:36:00.000Z";
  const result = assessProductForActivation({
    product: product({ checkedAt: newerCheckedAt, recommendation }),
    financialGateCertified: true,
    nowMs: NOW,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "BLOCKED_SOURCE_CHANGED");
});

test("activation rejects recommendations below DealForge minimum profit policy", () => {
  const weakPricing = {
    targetGrossMarginBps: 0,
    minimumProfitCents: 0,
    paymentFeeBps: 0,
    paymentFixedFeeCents: 0,
    priceCeilingCents: 5_000,
  };
  const recommendation = recommendationFor({ pricing: weakPricing });
  const result = assessProductForActivation({
    product: product({ recommendation, pricing: weakPricing }),
    financialGateCertified: true,
    nowMs: NOW,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "BLOCKED_POLICY_FLOOR");
});

test("persisted financials must equal the saved recommendation", () => {
  const base = product();
  const result = assessProductForActivation({
    product: { ...base, sellingPriceCents: (base.sellingPriceCents ?? 0) + 1 },
    financialGateCertified: true,
    nowMs: NOW,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "BLOCKED_FINANCIAL_MISMATCH");
});

test("supplier routing must be ready before activation", () => {
  const result = assessProductForActivation({
    product: product({ affiliateUrl: "https://example.com/product/B000000001" }),
    financialGateCertified: true,
    nowMs: NOW,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "BLOCKED_SUPPLIER_ROUTE");
});

test("activation and disable metadata preserve an auditable state transition", () => {
  const assessment = assessProductForActivation({ product: product(), financialGateCertified: true, nowMs: NOW });
  assert.equal(assessment.eligible, true);
  const activated = activationAuditSpecifications({
    specifications: product().specifications,
    activatedAt: new Date(NOW).toISOString(),
    activatedByUserId: "owner-1",
    assessment,
    fulfillmentMode: "manual_supplier_purchase",
  });
  const activatedJson = parseRecord(activated);
  const activation = nestedRecord(activatedJson.commerceActivation);
  assert.equal(activation.state, "active");
  assert.equal(activation.fulfillmentMode, "manual_supplier_purchase");

  const disabled = disabledActivationSpecifications(activated, "2026-08-23T02:41:00.000Z", "owner-1");
  const disabledJson = parseRecord(disabled);
  const disabledActivation = nestedRecord(disabledJson.commerceActivation);
  assert.equal(disabledActivation.state, "disabled");
  assert.equal(disabledActivation.fulfillmentMode, "manual_supplier_purchase");
  assert.equal(disabledActivation.disabledByUserId, "owner-1");
});
