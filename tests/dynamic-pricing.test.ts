import assert from "node:assert/strict";
import test from "node:test";
import { quoteSellingPrice } from "../src/lib/dynamic-pricing";

test("meets target gross margin and minimum profit after payment fees", () => {
  const quote = quoteSellingPrice({
    landedCostCents: 1_000,
    targetGrossMarginBps: 2_000,
    minimumProfitCents: 150,
    paymentFeeBps: 300,
    paymentFixedFeeCents: 30,
  });

  assert.equal(quote.eligible, true);
  assert.equal(quote.reason, "OK");
  assert.ok((quote.estimatedProfitCents ?? 0) >= 150);
  assert.ok((quote.grossMarginBps ?? 0) >= 2_000);
});

test("fails closed when the required profitable price exceeds a cap", () => {
  const quote = quoteSellingPrice({
    landedCostCents: 1_000,
    targetGrossMarginBps: 2_500,
    paymentFeeBps: 300,
    paymentFixedFeeCents: 30,
    priceCeilingCents: 1_200,
  });

  assert.deepEqual(quote, {
    eligible: false,
    reason: "PRICE_CAP_EXCEEDED",
    sellingPriceCents: null,
    estimatedPaymentFeeCents: null,
    estimatedProfitCents: null,
    grossMarginBps: null,
  });
});

test("minimum profit can dominate the margin target", () => {
  const quote = quoteSellingPrice({
    landedCostCents: 500,
    targetGrossMarginBps: 500,
    minimumProfitCents: 500,
    paymentFeeBps: 0,
    paymentFixedFeeCents: 0,
  });

  assert.equal(quote.eligible, true);
  assert.equal(quote.sellingPriceCents, 1_000);
  assert.equal(quote.estimatedProfitCents, 500);
});

test("rejects impossible fee plus margin combinations", () => {
  const quote = quoteSellingPrice({
    landedCostCents: 1_000,
    targetGrossMarginBps: 9_800,
    paymentFeeBps: 300,
  });

  assert.equal(quote.eligible, false);
  assert.equal(quote.reason, "UNATTAINABLE_MARGIN");
});

test("never treats a zero landed cost as a valid autonomous quote", () => {
  const quote = quoteSellingPrice({
    landedCostCents: 0,
    targetGrossMarginBps: 2_000,
  });

  assert.equal(quote.eligible, false);
  assert.equal(quote.reason, "INVALID_INPUT");
});

test("fails closed when financial values exceed JavaScript safe-integer range", () => {
  const quote = quoteSellingPrice({
    landedCostCents: Number.MAX_SAFE_INTEGER,
    targetGrossMarginBps: 2_000,
    paymentFixedFeeCents: Number.MAX_SAFE_INTEGER,
  });

  assert.equal(quote.eligible, false);
  assert.equal(quote.reason, "INVALID_INPUT");
});
