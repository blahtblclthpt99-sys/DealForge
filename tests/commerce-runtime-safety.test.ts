import assert from "node:assert/strict";
import test from "node:test";
import { checkDirectCommerceProductSafety } from "../src/lib/commerce-runtime-safety";

const NOW = Date.parse("2026-08-22T22:00:00.000Z");

function specifications(overrides: Record<string, unknown> = {}) {
  return {
    commerceRecommendation: {
      status: "owner_reviewed_recommendation",
      assessedAt: "2026-08-22T21:35:00.000Z",
      sourceCheckedAt: "2026-08-22T21:30:00.000Z",
      sourceVerified: true,
      sourceAvailable: true,
      maxSourceAgeMs: 3_600_000,
      sourceIdentity: {
        retailer: "amazon",
        sourceUrl: "https://www.amazon.com/dp/B000000001",
        asin: "B000000001",
      },
      result: {
        landedCostCents: 1_200,
        recommendedSellingPriceCents: 1_799,
      },
      ...overrides,
    },
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    financialGateCertified: true,
    commerceEnabled: true,
    availability: "in_stock",
    currency: "usd",
    landedCostCents: 1_200,
    sellingPriceCents: 1_799,
    specifications: specifications(),
    retailer: "amazon",
    sourceUrl: "https://www.amazon.com/dp/B000000001",
    asin: "B000000001",
    nowMs: NOW,
    ...overrides,
  };
}

test("combined runtime safety passes only when readiness and source identity both pass", () => {
  const result = checkDirectCommerceProductSafety(input());
  assert.equal(result.safe, true);
  assert.equal(result.reason, "READY");
  assert.equal(result.readiness.ready, true);
  assert.equal(result.sourceBinding?.bound, true);
});

test("financial or freshness failure blocks before source binding", () => {
  const finance = checkDirectCommerceProductSafety(input({ financialGateCertified: false }));
  assert.equal(finance.safe, false);
  assert.equal(finance.reason, "BLOCKED_FINANCIAL_GATE");
  assert.equal(finance.sourceBinding, null);

  const stale = checkDirectCommerceProductSafety(input({ nowMs: Date.parse("2026-08-22T22:30:00.001Z") }));
  assert.equal(stale.safe, false);
  assert.equal(stale.reason, "SOURCE_STALE");
  assert.equal(stale.sourceBinding, null);
});

test("supplier URL drift blocks an otherwise financially ready product", () => {
  const result = checkDirectCommerceProductSafety(input({
    sourceUrl: "https://www.amazon.com/dp/B000000002",
  }));
  assert.equal(result.readiness.ready, true);
  assert.equal(result.safe, false);
  assert.equal(result.reason, "SOURCE_IDENTITY_DRIFT");
  assert.equal(result.sourceBinding?.bound, false);
});

test("retailer or ASIN drift blocks an otherwise financially ready product", () => {
  assert.equal(
    checkDirectCommerceProductSafety(input({ retailer: "walmart" })).reason,
    "SOURCE_IDENTITY_DRIFT",
  );
  assert.equal(
    checkDirectCommerceProductSafety(input({ asin: "B000000002" })).reason,
    "SOURCE_IDENTITY_DRIFT",
  );
});

test("missing or invalid source identity fails closed", () => {
  const missing = checkDirectCommerceProductSafety(input({
    specifications: {
      commerceRecommendation: {
        ...specifications().commerceRecommendation,
        sourceIdentity: undefined,
      },
    },
  }));
  assert.equal(missing.safe, false);
  assert.equal(missing.reason, "SOURCE_IDENTITY_MISSING");

  const invalid = checkDirectCommerceProductSafety(input({ sourceUrl: "http://localhost/item" }));
  assert.equal(invalid.safe, false);
  assert.equal(invalid.reason, "SOURCE_IDENTITY_INVALID");
});
