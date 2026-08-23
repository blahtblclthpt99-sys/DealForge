import assert from "node:assert/strict";
import test from "node:test";
import {
  actualSupplierCostFromFulfillmentLogs,
  calculateOrderProfitability,
  rollupOrderProfitability,
} from "../src/lib/order-profitability";

function base(overrides: Partial<Parameters<typeof calculateOrderProfitability>[0]> = {}) {
  return calculateOrderProfitability({
    currency: "usd",
    totalCents: 10_000,
    refundedCents: 0,
    paymentCertified: true,
    estimatedSupplierCostCents: 6_000,
    actualSupplierCostCents: 5_500,
    ...overrides,
  });
}

test("invalid money inputs fail closed instead of becoming zero-dollar profit", () => {
  assert.equal(base({ totalCents: -1 }).status, "INVALID_INPUT");
  assert.equal(base({ refundedCents: 10_001 }).status, "INVALID_INPUT");
  assert.equal(base({ actualSupplierCostCents: 0 }).status, "INVALID_INPUT");
  assert.equal(base({ totalCents: Number.MAX_SAFE_INTEGER + 1 }).status, "INVALID_INPUT");
});

test("uncertified payment is excluded from realized rollups", () => {
  const result = base({ paymentCertified: false });
  assert.equal(result.eligibleForRollup, false);
  assert.equal(result.status, "FINANCIAL_UNVERIFIED");
  assert.equal(result.contributionCents, null);
});

test("actual supplier cost is required before contribution is realized", () => {
  const result = base({ actualSupplierCostCents: null });
  assert.equal(result.eligibleForRollup, false);
  assert.equal(result.status, "AWAITING_ACTUAL_SUPPLIER_COST");
  assert.equal(result.contributionCents, null);
});

test("positive contribution and supplier cost variance use actual procurement cost", () => {
  const result = base({ estimatedSupplierCostCents: 6_000, actualSupplierCostCents: 5_500 });
  assert.equal(result.status, "POSITIVE_CONTRIBUTION");
  assert.equal(result.netCustomerRevenueCents, 10_000);
  assert.equal(result.supplierCostVarianceCents, -500);
  assert.equal(result.contributionCents, 4_500);
  assert.equal(result.contributionMarginBps, 4_500);
  assert.equal(result.excludesPaymentFeesAndOverhead, true);
});

test("partial refunds reduce realized contribution", () => {
  const result = base({ refundedCents: 2_000, actualSupplierCostCents: 5_500 });
  assert.equal(result.netCustomerRevenueCents, 8_000);
  assert.equal(result.contributionCents, 2_500);
  assert.equal(result.contributionMarginBps, 3_125);
});

test("full refund after supplier purchase becomes negative contribution", () => {
  const result = base({ refundedCents: 10_000, actualSupplierCostCents: 5_500 });
  assert.equal(result.status, "NEGATIVE_CONTRIBUTION");
  assert.equal(result.netCustomerRevenueCents, 0);
  assert.equal(result.contributionCents, -5_500);
  assert.equal(result.contributionMarginBps, null);
});

test("cost overrun is visible even while order still contributes positively", () => {
  const result = base({ estimatedSupplierCostCents: 5_000, actualSupplierCostCents: 7_000 });
  assert.equal(result.supplierCostVarianceCents, 2_000);
  assert.equal(result.contributionCents, 3_000);
  assert.equal(result.status, "POSITIVE_CONTRIBUTION");
});

test("rollup includes only realized eligible orders", () => {
  const realizedPositive = base();
  const realizedNegative = base({ totalCents: 5_000, refundedCents: 1_000, estimatedSupplierCostCents: 4_000, actualSupplierCostCents: 4_500 });
  const awaiting = base({ actualSupplierCostCents: null });
  const unverified = base({ paymentCertified: false });
  const result = rollupOrderProfitability([realizedPositive, realizedNegative, awaiting, unverified]);

  assert.equal(result.orderCount, 4);
  assert.equal(result.realizedOrderCount, 2);
  assert.equal(result.awaitingCostCount, 1);
  assert.equal(result.excludedCount, 2);
  assert.equal(result.negativeContributionCount, 1);
  assert.equal(result.netCustomerRevenueCents, 14_000);
  assert.equal(result.actualSupplierCostCents, 10_000);
  assert.equal(result.contributionCents, 4_000);
  assert.equal(result.contributionMarginBps, 2_857);
});

test("actual supplier cost is recovered only from the supplier-ordered journal entry", () => {
  const logs = [
    { message: "MARK_SHIPPED", meta: JSON.stringify({ trackingNumber: "TRACK-1" }) },
    { message: "MARK_SUPPLIER_ORDERED", meta: JSON.stringify({ actualCostCents: 6_250, supplierOrders: [{ supplierOrderReference: "private" }] }) },
  ];
  assert.equal(actualSupplierCostFromFulfillmentLogs(logs), 6_250);
  assert.equal(actualSupplierCostFromFulfillmentLogs([{ message: "MARK_SHIPPED", meta: "{}" }]), null);
  assert.equal(actualSupplierCostFromFulfillmentLogs([{ message: "MARK_SUPPLIER_ORDERED", meta: "bad-json" }]), null);
});
