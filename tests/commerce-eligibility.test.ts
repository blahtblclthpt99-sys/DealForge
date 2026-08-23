import assert from "node:assert/strict";
import test from "node:test";
import { assessCommerceEligibility } from "../src/lib/commerce-eligibility";

const NOW = 1_787_448_000_000;

function baseInput() {
  return {
    financialGateCertified: true,
    landedCost: {
      itemCostCents: 1_000,
      shippingCents: 125,
      estimatedTaxCents: 90,
      handlingCents: 35,
      procurementBufferCents: 50,
      otherCostCents: 0,
      sourceVerified: true,
      sourceAvailable: true,
      sourceCheckedAtMs: NOW - 60_000,
      maxSourceAgeMs: 86_400_000,
      nowMs: NOW,
    },
    pricing: {
      targetGrossMarginBps: 2_000,
      minimumProfitCents: 300,
      paymentFeeBps: 300,
      paymentFixedFeeCents: 30,
      priceCeilingCents: 5_000,
    },
  };
}

test("returns an advisory commerce recommendation when every gate is satisfied", () => {
  const result = assessCommerceEligibility(baseInput());
  assert.equal(result.eligible, true);
  assert.equal(result.reason, "ELIGIBLE");
  assert.equal(result.landedCostCents, 1_300);
  assert.ok((result.recommendedSellingPriceCents || 0) > 1_300);
  assert.ok((result.estimatedProfitCents || 0) >= 300);
  assert.ok((result.grossMarginBps || 0) >= 2_000);
  assert.ok((result.profitabilityScore || 0) >= 0 && (result.profitabilityScore || 0) <= 100);
  assert.notEqual(result.profitabilityTier, "blocked");
});

test("financial certification is a hard commerce eligibility gate", () => {
  const result = assessCommerceEligibility({ ...baseInput(), financialGateCertified: false });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "BLOCKED_FINANCIAL_GATE");
  assert.equal(result.pricingQuote, null);
});

test("maps unverified, unavailable, and stale source data to explicit block reasons", () => {
  assert.equal(
    assessCommerceEligibility({ ...baseInput(), landedCost: { ...baseInput().landedCost, sourceVerified: false } }).reason,
    "BLOCKED_UNVERIFIED_SOURCE",
  );
  assert.equal(
    assessCommerceEligibility({ ...baseInput(), landedCost: { ...baseInput().landedCost, sourceAvailable: false } }).reason,
    "BLOCKED_UNAVAILABLE",
  );
  assert.equal(
    assessCommerceEligibility({
      ...baseInput(),
      landedCost: { ...baseInput().landedCost, sourceCheckedAtMs: NOW - 86_400_001 },
    }).reason,
    "BLOCKED_STALE_SOURCE",
  );
});

test("price ceiling failures remain fail-closed instead of lowering margin", () => {
  const result = assessCommerceEligibility({
    ...baseInput(),
    pricing: { ...baseInput().pricing, priceCeilingCents: 1_400 },
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "BLOCKED_PRICE_CAP");
  assert.equal(result.landedCostCents, 1_300);
});

test("impossible margin and fee combinations are blocked", () => {
  const result = assessCommerceEligibility({
    ...baseInput(),
    pricing: { ...baseInput().pricing, targetGrossMarginBps: 9_000, paymentFeeBps: 1_000 },
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "BLOCKED_MARGIN");
});
