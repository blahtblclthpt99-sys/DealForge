import assert from "node:assert/strict";
import test from "node:test";
import {
  attributableCostFromSpecifications,
  calculateCustomerFriendlyPrice,
  calculateMinimumSafeCustomerPrice,
  minimumSafeProfitCents,
  roundToFriendlyPrice,
} from "../src/lib/cart-pricing";

const POLICY = {
  paymentRateBps: 350,
  paymentFixedCents: 30,
  lossReserveBps: 100,
};

test("minimum profit uses the higher of the dollar floor or percentage floor without stacking", () => {
  assert.equal(minimumSafeProfitCents(500), 200);
  assert.equal(minimumSafeProfitCents(1_500), 250);
  assert.equal(minimumSafeProfitCents(3_000), 360);
  assert.equal(minimumSafeProfitCents(10_000), 800);
  assert.equal(minimumSafeProfitCents(40_000), 2_000);
  assert.equal(minimumSafeProfitCents(70_000), 2_800);
});

test("friendly pricing rounds only upward to .49 or .99", () => {
  assert.equal(roundToFriendlyPrice(3_408), 3_449);
  assert.equal(roundToFriendlyPrice(3_455), 3_499);
  assert.equal(roundToFriendlyPrice(3_504), 3_549);
  assert.equal(roundToFriendlyPrice(3_599), 3_599);
});

test("canonical minimum-safe price includes only landed cost, attributable cost, payment cost, pooled loss reserve, and profit", () => {
  const decision = calculateMinimumSafeCustomerPrice({
    landedCostCents: 3_000,
    attributableCostCents: 250,
    policy: POLICY,
  });

  assert.equal(decision.pricingBasisCents, 3_250);
  assert.equal(decision.attributableCostCents, 250);
  assert.equal(decision.minimumProfitCents, 390);
  assert.ok(decision.estimatedContributionProfitCents >= decision.minimumProfitCents);
  assert.ok([49, 99].includes(decision.customerPriceCents % 100));
});

test("cart calculates the lowest safe price and exposes savings against the published ceiling", () => {
  const decision = calculateCustomerFriendlyPrice({
    landedCostCents: 3_000,
    publishedPriceCents: 5_000,
    policy: POLICY,
  });

  assert.equal(decision.eligible, true);
  assert.equal(decision.minimumProfitCents, 360);
  assert.equal(decision.customerPriceCents, 3_599);
  assert.equal(decision.savingsCents, 1_401);
  assert.ok(decision.estimatedContributionProfitCents >= decision.minimumProfitCents);
});

test("explicit attributable cost is preserved across V2 and legacy V1 metadata", () => {
  assert.equal(
    attributableCostFromSpecifications(JSON.stringify({
      commerceV2: { attributableAcquisitionCostCents: 275 },
      commerceV1: { reserves: { acquisitionCents: 999 } },
    })),
    275,
  );
  assert.equal(
    attributableCostFromSpecifications(JSON.stringify({
      commerceV1: { reserves: { acquisitionCents: 125, supportCents: 500, fraudCents: 500 } },
    })),
    125,
  );
  assert.equal(attributableCostFromSpecifications("not-json"), 0);
});

test("cart blocks instead of surprising the customer when the safe price exceeds the published price", () => {
  const decision = calculateCustomerFriendlyPrice({
    landedCostCents: 3_000,
    publishedPriceCents: 3_499,
    policy: POLICY,
  });

  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "PUBLISHED_PRICE_NO_LONGER_SAFE");
  assert.equal(decision.savingsCents, 0);
});

test("monthly loss reserve cannot exceed the canonical 2 percent cap", () => {
  assert.throws(
    () => calculateCustomerFriendlyPrice({
      landedCostCents: 3_000,
      publishedPriceCents: 5_000,
      policy: { ...POLICY, lossReserveBps: 201 },
    }),
    /CART_PRICING_POLICY_INVALID/,
  );
});
