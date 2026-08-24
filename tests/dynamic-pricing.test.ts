import assert from "node:assert/strict";
import test from "node:test";
import { recommendSellingPrice } from "../src/lib/dynamic-pricing";

test("recommended price clears both profit and margin floors", () => {
  const result = recommendSellingPrice({
    landedCostCents: 3000,
    reserveTotalCents: 575,
    minContributionProfitCents: 500,
    minContributionMarginBps: 1000,
    psychologicalEndingCents: 99,
  });
  assert.ok(result.recommendedPriceCents >= result.minimumSafePriceCents);
  assert.ok(result.contributionProfitCents >= 500);
  assert.ok(result.contributionMarginBps >= 1000);
  assert.equal(result.recommendedPriceCents % 100, 99);
});

test("market ceiling marks commercially unsafe recommendations without lowering below profit floor", () => {
  const result = recommendSellingPrice({
    landedCostCents: 8000,
    reserveTotalCents: 1000,
    minContributionProfitCents: 2000,
    minContributionMarginBps: 2000,
    marketReferenceCents: 9000,
    maxMarketPremiumBps: 500,
  });
  assert.equal(result.marketCompatible, false);
  assert.match(result.reasons.join(","), /safe_price_exceeds_market_ceiling/);
  assert.ok(result.contributionProfitCents >= 2000);
  assert.ok(result.contributionMarginBps >= 2000);
});

test("invalid economics fail closed", () => {
  assert.throws(() => recommendSellingPrice({
    landedCostCents: 0,
    reserveTotalCents: 0,
    minContributionProfitCents: 500,
    minContributionMarginBps: 1000,
  }), /LANDED_COST_CENTS_INVALID/);
});
