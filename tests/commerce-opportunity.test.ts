import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateCommerceOpportunity,
  rankCommerceOpportunities,
  type CommerceOpportunityInput,
} from "../src/lib/commerce-opportunity";

const NOW = Date.parse("2026-08-23T05:15:00.000Z");

function input(overrides: Partial<CommerceOpportunityInput> = {}): CommerceOpportunityInput {
  return {
    id: "p1",
    title: "Product One",
    financialGateCertified: true,
    commerceEnabled: false,
    availability: "in_stock",
    currency: "usd",
    landedCostCents: 5_000,
    sellingPriceCents: 8_000,
    retailer: "amazon",
    sourceUrl: "https://www.amazon.com/dp/B000000001",
    asin: "B000000001",
    clickCount: 4,
    viewCount: 20,
    nowMs: NOW,
    specifications: {
      commerceRecommendation: {
        status: "owner_reviewed_recommendation",
        assessedAt: "2026-08-23T05:00:00.000Z",
        sourceCheckedAt: "2026-08-23T04:55:00.000Z",
        sourceVerified: true,
        sourceAvailable: true,
        maxSourceAgeMs: 24 * 60 * 60 * 1000,
        sourceIdentity: {
          retailer: "amazon",
          sourceUrl: "https://www.amazon.com/dp/B000000001",
          asin: "B000000001",
        },
        result: {
          landedCostCents: 5_000,
          recommendedSellingPriceCents: 8_000,
          estimatedProfitCents: 2_500,
          grossMarginBps: 3_125,
          profitabilityScore: 82,
          profitabilityTier: "strong",
        },
      },
    },
    ...overrides,
  };
}

test("reviewed current recommendation becomes activation-ready opportunity", () => {
  const result = evaluateCommerceOpportunity(input());
  assert.equal(result.readyForOwnerActivation, true);
  assert.equal(result.readinessReason, "READY");
  assert.equal(result.profitabilityTier, "strong");
  assert.equal(result.profitabilityScore, 82);
  assert.equal(result.estimatedProfitCents, 2_500);
  assert.ok((result.sourceFreshnessRemainingMs || 0) > 0);
});

test("supplier identity drift blocks an otherwise profitable opportunity", () => {
  const result = evaluateCommerceOpportunity(input({ sourceUrl: "https://www.amazon.com/dp/B000000002" }));
  assert.equal(result.readyForOwnerActivation, false);
  assert.equal(result.readinessReason, "SOURCE_IDENTITY_DRIFT");
  assert.equal(result.profitabilityScore, 82);
});

test("stale source or financial drift blocks activation readiness", () => {
  const stale = evaluateCommerceOpportunity(input({ nowMs: Date.parse("2026-08-24T06:00:00.000Z") }));
  const drift = evaluateCommerceOpportunity(input({ sellingPriceCents: 8_001 }));
  assert.equal(stale.readyForOwnerActivation, false);
  assert.equal(stale.readinessReason, "SOURCE_STALE");
  assert.equal(drift.readyForOwnerActivation, false);
  assert.equal(drift.readinessReason, "FINANCIAL_DRIFT");
});

test("ranking puts activation-ready products before blocked products even when blocked score is higher", () => {
  const ready = evaluateCommerceOpportunity(input({ id: "ready", title: "Ready" }));
  const blockedHighScore = evaluateCommerceOpportunity(input({
    id: "blocked",
    title: "Blocked",
    sourceUrl: "https://www.amazon.com/dp/B000000009",
    specifications: {
      commerceRecommendation: {
        status: "owner_reviewed_recommendation",
        assessedAt: "2026-08-23T05:00:00.000Z",
        sourceCheckedAt: "2026-08-23T04:55:00.000Z",
        sourceVerified: true,
        sourceAvailable: true,
        maxSourceAgeMs: 24 * 60 * 60 * 1000,
        sourceIdentity: {
          retailer: "amazon",
          sourceUrl: "https://www.amazon.com/dp/B000000001",
          asin: "B000000001",
        },
        result: {
          landedCostCents: 5_000,
          recommendedSellingPriceCents: 8_000,
          estimatedProfitCents: 3_000,
          grossMarginBps: 3_750,
          profitabilityScore: 99,
          profitabilityTier: "strong",
        },
      },
    },
  }));
  assert.deepEqual(rankCommerceOpportunities([blockedHighScore, ready]).map((row) => row.id), ["ready", "blocked"]);
});

test("ready opportunities use saved tier, score, contribution, margin, then freshness for ordering", () => {
  const strongLowerScore = evaluateCommerceOpportunity(input({
    id: "strong",
    title: "Strong",
    specifications: {
      commerceRecommendation: {
        status: "owner_reviewed_recommendation",
        assessedAt: "2026-08-23T05:00:00.000Z",
        sourceCheckedAt: "2026-08-23T04:55:00.000Z",
        sourceVerified: true,
        sourceAvailable: true,
        maxSourceAgeMs: 24 * 60 * 60 * 1000,
        sourceIdentity: { retailer: "amazon", sourceUrl: "https://www.amazon.com/dp/B000000001", asin: "B000000001" },
        result: { landedCostCents: 5_000, recommendedSellingPriceCents: 8_000, estimatedProfitCents: 2_000, grossMarginBps: 2_500, profitabilityScore: 76, profitabilityTier: "strong" },
      },
    },
  }));
  const healthyHighScore = evaluateCommerceOpportunity(input({
    id: "healthy",
    title: "Healthy",
    specifications: {
      commerceRecommendation: {
        status: "owner_reviewed_recommendation",
        assessedAt: "2026-08-23T05:00:00.000Z",
        sourceCheckedAt: "2026-08-23T04:55:00.000Z",
        sourceVerified: true,
        sourceAvailable: true,
        maxSourceAgeMs: 24 * 60 * 60 * 1000,
        sourceIdentity: { retailer: "amazon", sourceUrl: "https://www.amazon.com/dp/B000000001", asin: "B000000001" },
        result: { landedCostCents: 5_000, recommendedSellingPriceCents: 8_000, estimatedProfitCents: 2_900, grossMarginBps: 3_600, profitabilityScore: 90, profitabilityTier: "healthy" },
      },
    },
  }));
  assert.deepEqual(rankCommerceOpportunities([healthyHighScore, strongLowerScore]).map((row) => row.id), ["strong", "healthy"]);
});

test("demand signals are context only and do not outrank saved profitability", () => {
  const higherProfitability = evaluateCommerceOpportunity(input({ id: "profit", title: "Profit", clickCount: 0, viewCount: 0 }));
  const popularLowerScore = evaluateCommerceOpportunity(input({
    id: "popular",
    title: "Popular",
    clickCount: 100_000,
    viewCount: 1_000_000,
    specifications: {
      commerceRecommendation: {
        status: "owner_reviewed_recommendation",
        assessedAt: "2026-08-23T05:00:00.000Z",
        sourceCheckedAt: "2026-08-23T04:55:00.000Z",
        sourceVerified: true,
        sourceAvailable: true,
        maxSourceAgeMs: 24 * 60 * 60 * 1000,
        sourceIdentity: { retailer: "amazon", sourceUrl: "https://www.amazon.com/dp/B000000001", asin: "B000000001" },
        result: { landedCostCents: 5_000, recommendedSellingPriceCents: 8_000, estimatedProfitCents: 2_400, grossMarginBps: 3_000, profitabilityScore: 80, profitabilityTier: "strong" },
      },
    },
  }));
  assert.deepEqual(rankCommerceOpportunities([popularLowerScore, higherProfitability]).map((row) => row.id), ["profit", "popular"]);
});
