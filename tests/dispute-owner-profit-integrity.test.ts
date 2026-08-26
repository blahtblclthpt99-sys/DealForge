import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { analyzeOrderOperations } from "../src/lib/order-operations";
import { analyzeOrderProfit } from "../src/lib/profit-analytics";

function paymentWithDispute(status: string) {
  return {
    status: "succeeded",
    amountCents: 10_000,
    currency: "usd",
    meta: JSON.stringify({
      source: "stripe_webhook",
      processingFeeCents: 300,
      processingFeeCurrency: "usd",
      processingFeeSource: "stripe_balance_transaction",
      processingFeeChargeId: "ch_profit123",
      processingFeeBalanceTransactionId: "txn_profit123",
      processingFeeGrossCents: 10_000,
      processingFeeNetCents: 9_700,
      stripeDisputesV1: {
        version: 1,
        entries: {
          dp_profit123: {
            disputeId: "dp_profit123",
            paymentIntentId: "pi_profit123",
            chargeId: "ch_profit123",
            amountCents: 10_000,
            currency: "usd",
            status,
            reason: "fraudulent",
            lastEventId: "evt_profit123",
            lastEventType: status === "won" ? "charge.dispute.closed" : "charge.dispute.updated",
            eventCreated: 1_787_767_000,
            updatedAt: "2026-08-26T18:10:00.000Z",
          },
        },
      },
    }),
  };
}

function completeProfitInput(payment: ReturnType<typeof paymentWithDispute>) {
  return {
    subtotalCents: 10_000,
    shippingCents: 0,
    taxCents: 0,
    totalCents: 10_000,
    currency: "usd",
    refunds: [],
    payments: [payment],
    items: [
      {
        id: "line-dispute",
        lineTotalCents: 10_000,
        procurementIntent: {
          expectedTotalCostCents: 5_000,
          actualTotalCostCents: 5_000,
          quantity: 1,
          events: [],
        },
      },
    ],
  };
}

test("active Stripe dispute blocks otherwise complete contribution certification", () => {
  const result = analyzeOrderProfit(completeProfitInput(paymentWithDispute("needs_response")));
  assert.equal(result.integrity.disputeStateClear, false);
  assert.equal(result.integrity.activeDisputeCount, 1);
  assert.equal(result.integrity.lostDisputeCount, 0);
  assert.equal(result.contribution.certified, false);
  assert.equal(result.contribution.certifiedOrderContributionCents, null);
  assert.ok(result.contribution.finalizationReasons.includes("PAYMENT_DISPUTE_ACTIVE"));
});

test("lost Stripe dispute is never certified as retained profit", () => {
  const result = analyzeOrderProfit(completeProfitInput(paymentWithDispute("lost")));
  assert.equal(result.integrity.disputeStateClear, false);
  assert.equal(result.integrity.lostDisputeCount, 1);
  assert.equal(result.contribution.certified, false);
  assert.ok(result.contribution.finalizationReasons.includes("PAYMENT_DISPUTE_LOST"));
});

test("won Stripe dispute remains uncertified until reinstated funds are independently proven", () => {
  const result = analyzeOrderProfit(completeProfitInput(paymentWithDispute("won")));
  assert.equal(result.integrity.disputeStateClear, false);
  assert.equal(result.integrity.activeDisputeCount, 1);
  assert.equal(result.integrity.lostDisputeCount, 0);
  assert.equal(result.contribution.finalizationReasons.includes("PAYMENT_DISPUTE_ACTIVE"), true);
  assert.equal(result.contribution.finalizationReasons.includes("PAYMENT_DISPUTE_LOST"), false);
  assert.equal(result.contribution.certified, false);
  assert.equal(result.contribution.certifiedOrderContributionCents, null);
});

test("malformed dispute ledger fails profit certification closed", () => {
  const payment = paymentWithDispute("needs_response");
  const meta = JSON.parse(payment.meta) as Record<string, unknown>;
  meta.stripeDisputesV1 = { version: 99, entries: {} };
  payment.meta = JSON.stringify(meta);
  const result = analyzeOrderProfit(completeProfitInput(payment));
  assert.equal(result.integrity.invalidDisputeStateCount, 1);
  assert.equal(result.contribution.certified, false);
  assert.ok(result.contribution.finalizationReasons.includes("PAYMENT_DISPUTE_STATE_INVALID"));
});

test("disputed and lost orders are critical owner operations exceptions", () => {
  for (const [orderStatus, code] of [
    ["payment_disputed", "PAYMENT_DISPUTE_ACTIVE"],
    ["payment_dispute_lost", "PAYMENT_DISPUTE_LOST"],
  ] as const) {
    const result = analyzeOrderOperations({
      orderStatus,
      totalCents: 10_000,
      refunds: [],
      items: [
        {
          id: "line-ops",
          lineTotalCents: 10_000,
          procurementIntent: {
            status: "supplier_ordered_manual",
            blockedReason: null,
            expectedTotalCostCents: 5_000,
            actualTotalCostCents: 5_000,
            createdAt: "2026-08-26T18:00:00.000Z",
            updatedAt: "2026-08-26T18:00:00.000Z",
          },
        },
      ],
      nowMs: Date.parse("2026-08-26T18:10:00.000Z"),
    });
    assert.equal(result.highestSeverity, "critical");
    assert.ok(result.exceptions.some((item) => item.code === code));
  }
});

test("owner commerce feed keeps disputed orders visible and read-only", () => {
  const route = readFileSync(join(process.cwd(), "src/app/api/admin/commerce/orders/route.ts"), "utf8");
  assert.match(route, /"payment_disputed"/);
  assert.match(route, /"payment_dispute_lost"/);
  assert.match(route, /orderStatus: order\.status/);
  assert.match(route, /activeDisputeOrders/);
  assert.match(route, /lostDisputeOrders/);
  assert.match(route, /no active, lost, or malformed payment disputes/);
  assert.match(route, /readOnly: true/);
  assert.match(route, /automaticSupplierPurchasingEnabled: false/);
  assert.doesNotMatch(route, /export async function POST/);
});
