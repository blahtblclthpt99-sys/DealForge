import assert from "node:assert/strict";
import test from "node:test";
import { checkDirectCommerceReadiness } from "../src/lib/direct-commerce-readiness";

const NOW = Date.parse("2026-08-22T22:00:00.000Z");
const SOURCE_CHECKED = Date.parse("2026-08-22T21:30:00.000Z");

function specifications(overrides: Record<string, unknown> = {}) {
  return {
    commerceRecommendation: {
      status: "owner_reviewed_recommendation",
      assessedAt: "2026-08-22T21:35:00.000Z",
      sourceCheckedAt: "2026-08-22T21:30:00.000Z",
      sourceVerified: true,
      sourceAvailable: true,
      maxSourceAgeMs: 3_600_000,
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
    nowMs: NOW,
    ...overrides,
  };
}

test("ready requires certified finance, active commerce, current source, and exact reviewed financials", () => {
  const result = checkDirectCommerceReadiness(input());
  assert.deepEqual(result, {
    ready: true,
    reason: "READY",
    sourceCheckedAtMs: SOURCE_CHECKED,
    sourceAgeMs: 1_800_000,
    maxSourceAgeMs: 3_600_000,
  });
});

test("financial gate can instantly fail direct commerce closed", () => {
  const result = checkDirectCommerceReadiness(input({ financialGateCertified: false }));
  assert.equal(result.ready, false);
  assert.equal(result.reason, "BLOCKED_FINANCIAL_GATE");
});

test("disabled or unavailable products are never ready", () => {
  assert.equal(checkDirectCommerceReadiness(input({ commerceEnabled: false })).reason, "COMMERCE_DISABLED");
  assert.equal(checkDirectCommerceReadiness(input({ availability: "out_of_stock" })).reason, "UNAVAILABLE");
});

test("source freshness expiration blocks direct commerce", () => {
  const result = checkDirectCommerceReadiness(input({ nowMs: SOURCE_CHECKED + 3_600_001 }));
  assert.equal(result.ready, false);
  assert.equal(result.reason, "SOURCE_STALE");
  assert.equal(result.sourceAgeMs, 3_600_001);
});

test("source verification and source availability are mandatory", () => {
  assert.equal(
    checkDirectCommerceReadiness(input({ specifications: specifications({ sourceVerified: false }) })).reason,
    "SOURCE_UNVERIFIED",
  );
  assert.equal(
    checkDirectCommerceReadiness(input({ specifications: specifications({ sourceAvailable: false }) })).reason,
    "SOURCE_UNAVAILABLE",
  );
});

test("stored price or landed cost drift from the reviewed recommendation fails closed", () => {
  assert.equal(
    checkDirectCommerceReadiness(input({ sellingPriceCents: 1_899 })).reason,
    "FINANCIAL_DRIFT",
  );
  assert.equal(
    checkDirectCommerceReadiness(input({ landedCostCents: 1_250 })).reason,
    "FINANCIAL_DRIFT",
  );
});

test("invalid currency, financial values, or recommendation structure fail closed", () => {
  assert.equal(checkDirectCommerceReadiness(input({ currency: "eur" })).reason, "INVALID_CURRENCY");
  assert.equal(checkDirectCommerceReadiness(input({ sellingPriceCents: null })).reason, "INVALID_FINANCIALS");
  assert.equal(checkDirectCommerceReadiness(input({ specifications: {} })).reason, "MISSING_RECOMMENDATION");
  assert.equal(
    checkDirectCommerceReadiness(input({ specifications: specifications({ assessedAt: "not-a-date" }) })).reason,
    "INVALID_RECOMMENDATION",
  );
});

test("JSON-encoded database specifications are accepted without weakening validation", () => {
  const result = checkDirectCommerceReadiness(input({ specifications: JSON.stringify(specifications()) }));
  assert.equal(result.ready, true);
  assert.equal(result.reason, "READY");
});
