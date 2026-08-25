import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { analyzeOrderProfit, authoritativePaymentFee } from "../src/lib/profit-analytics";

const refundKey = "refund-profit-12345";

function event(type: string, detail: Record<string, unknown>) {
  return {
    type,
    detail: JSON.stringify(detail),
    createdAt: "2026-08-25T04:00:00.000Z",
  };
}

function authoritativePayment(amountCents = 10_000) {
  return {
    status: "succeeded",
    amountCents,
    currency: "usd",
    meta: JSON.stringify({
      source: "stripe_webhook",
      processingFeeCents: 300,
      processingFeeCurrency: "usd",
      processingFeeSource: "stripe_balance_transaction",
      processingFeeChargeId: "ch_profit_123",
      processingFeeBalanceTransactionId: "txn_profit_123",
      processingFeeGrossCents: 10_000,
      processingFeeNetCents: 9_700,
    }),
  };
}

function recoveryIntent() {
  return {
    expectedTotalCostCents: 6_000,
    actualTotalCostCents: 6_000,
    quantity: 1,
    events: [
      event("POST_PURCHASE_REFUND_EXCEPTION_APPROVED", {
        refundIdempotencyKey: refundKey,
        amountCents: 2_000,
        recoveryPlan: "customer_keep_accept_loss",
      }),
      event("SUPPLIER_RECOVERY_RECORDED", {
        refundIdempotencyKey: refundKey,
        amountCents: 2_000,
      }),
      event("UNRECOVERED_LOSS_ACCEPTED", {
        refundIdempotencyKey: refundKey,
        amountCents: 4_000,
      }),
      event("RECOVERY_RECONCILED", {
        refundIdempotencyKey: refundKey,
      }),
    ],
  };
}

test("supplier recovery reduces supplier cost while accepted loss is not double counted", () => {
  const result = analyzeOrderProfit({
    subtotalCents: 10_000,
    shippingCents: 0,
    taxCents: 0,
    totalCents: 10_000,
    currency: "usd",
    refunds: [
      {
        idempotencyKey: refundKey,
        status: "succeeded",
        amountCents: 2_000,
        currency: "usd",
      },
    ],
    payments: [authoritativePayment()],
    items: [
      {
        id: "line-1",
        lineTotalCents: 10_000,
        procurementIntent: recoveryIntent(),
      },
    ],
  });

  assert.equal(result.supplier.knownActualSupplierCostCents, 6_000);
  assert.equal(result.supplier.supplierRecoveredCents, 2_000);
  assert.equal(result.supplier.netKnownSupplierCostCents, 4_000);
  assert.equal(result.supplier.acceptedLossCents, 4_000);
  assert.equal(result.contribution.contributionBeforeTaxAndPaymentFeesCents, 4_000);
  assert.equal(result.paymentProcessing.chargeFeeComplete, true);
  assert.equal(result.paymentProcessing.refundAdjustmentComplete, false);
  assert.equal(result.contribution.certified, false);
  assert.equal(result.contribution.certifiedOrderContributionCents, null);
  assert.ok(result.contribution.finalizationReasons.includes("REFUND_PROCESSING_ADJUSTMENT_UNKNOWN"));
});

test("unrefunded order with complete Stripe fee evidence can certify contribution", () => {
  const result = analyzeOrderProfit({
    subtotalCents: 10_000,
    shippingCents: 0,
    taxCents: 0,
    totalCents: 10_000,
    currency: "usd",
    refunds: [],
    payments: [authoritativePayment()],
    items: [
      {
        id: "line-certified",
        lineTotalCents: 10_000,
        procurementIntent: {
          expectedTotalCostCents: 5_000,
          actualTotalCostCents: 5_000,
          quantity: 1,
          events: [],
        },
      },
    ],
  });
  assert.equal(result.paymentProcessing.complete, true);
  assert.equal(result.contribution.certified, true);
  assert.equal(result.contribution.certifiedOrderContributionCents, 4_700);
});

test("estimated or unproven payment fee never certifies contribution", () => {
  const result = analyzeOrderProfit({
    subtotalCents: 10_000,
    shippingCents: 0,
    taxCents: 0,
    totalCents: 10_000,
    currency: "usd",
    refunds: [],
    payments: [
      {
        status: "succeeded",
        amountCents: 10_000,
        currency: "usd",
        meta: JSON.stringify({
          processingFeeCents: 300,
          processingFeeSource: "stripe_estimate",
        }),
      },
    ],
    items: [
      {
        id: "line-1",
        lineTotalCents: 10_000,
        procurementIntent: {
          expectedTotalCostCents: 5_000,
          actualTotalCostCents: 5_000,
          quantity: 1,
          events: [],
        },
      },
    ],
  });

  assert.equal(result.paymentProcessing.complete, false);
  assert.equal(result.contribution.certified, false);
  assert.ok(result.contribution.finalizationReasons.includes("PAYMENT_PROCESSING_COST_UNKNOWN"));
});

test("authoritative fee parser requires complete Stripe balance transaction provenance", () => {
  assert.equal(authoritativePaymentFee(authoritativePayment())?.feeCents, 300);
  assert.equal(
    authoritativePaymentFee({
      status: "succeeded",
      amountCents: 10_000,
      currency: "usd",
      meta: JSON.stringify({ processingFeeCents: 300, processingFeeSource: "manual_guess" }),
    }),
    null,
  );
  assert.equal(
    authoritativePaymentFee({
      ...authoritativePayment(),
      meta: JSON.stringify({
        processingFeeCents: 300,
        processingFeeCurrency: "usd",
        processingFeeSource: "stripe_balance_transaction",
      }),
    }),
    null,
  );
});

test("taxable refunded order stays uncertified without authoritative refund tax allocation", () => {
  const result = analyzeOrderProfit({
    subtotalCents: 9_000,
    shippingCents: 0,
    taxCents: 1_000,
    totalCents: 10_000,
    currency: "usd",
    refunds: [
      {
        idempotencyKey: "refund-tax-12345",
        status: "succeeded",
        amountCents: 1_000,
        currency: "usd",
      },
    ],
    payments: [authoritativePayment()],
    items: [
      {
        id: "line-tax",
        lineTotalCents: 9_000,
        procurementIntent: {
          expectedTotalCostCents: 4_000,
          actualTotalCostCents: 4_000,
          quantity: 1,
          events: [],
        },
      },
    ],
  });

  assert.equal(result.tax.complete, false);
  assert.equal(result.contribution.certified, false);
  assert.ok(result.contribution.finalizationReasons.includes("REFUND_TAX_ALLOCATION_UNKNOWN"));
  assert.ok(result.contribution.finalizationReasons.includes("REFUND_PROCESSING_ADJUSTMENT_UNKNOWN"));
});

test("pending refund prevents certified contribution", () => {
  const result = analyzeOrderProfit({
    subtotalCents: 10_000,
    shippingCents: 0,
    taxCents: 0,
    totalCents: 10_000,
    currency: "usd",
    refunds: [
      {
        idempotencyKey: "refund-pending-12345",
        status: "pending",
        amountCents: 1_000,
        currency: "usd",
      },
    ],
    payments: [authoritativePayment()],
    items: [
      {
        id: "line-pending",
        lineTotalCents: 10_000,
        procurementIntent: {
          expectedTotalCostCents: 4_000,
          actualTotalCostCents: 4_000,
          quantity: 1,
          events: [],
        },
      },
    ],
  });

  assert.equal(result.contribution.certified, false);
  assert.ok(result.contribution.finalizationReasons.includes("REFUND_PENDING"));
});

test("aggregate recovery across multiple cases cannot exceed one intent supplier cost", () => {
  const refundA = "refund-a-12345";
  const refundB = "refund-b-12345";
  const intent = {
    expectedTotalCostCents: 6_000,
    actualTotalCostCents: 6_000,
    quantity: 1,
    events: [
      event("POST_PURCHASE_REFUND_EXCEPTION_APPROVED", {
        refundIdempotencyKey: refundA,
        amountCents: 1_000,
        recoveryPlan: "customer_keep_accept_loss",
      }),
      event("SUPPLIER_RECOVERY_RECORDED", {
        refundIdempotencyKey: refundA,
        amountCents: 4_000,
      }),
      event("UNRECOVERED_LOSS_ACCEPTED", {
        refundIdempotencyKey: refundA,
        amountCents: 2_000,
      }),
      event("RECOVERY_RECONCILED", { refundIdempotencyKey: refundA }),
      event("POST_PURCHASE_REFUND_EXCEPTION_APPROVED", {
        refundIdempotencyKey: refundB,
        amountCents: 1_000,
        recoveryPlan: "customer_keep_accept_loss",
      }),
      event("SUPPLIER_RECOVERY_RECORDED", {
        refundIdempotencyKey: refundB,
        amountCents: 3_000,
      }),
      event("UNRECOVERED_LOSS_ACCEPTED", {
        refundIdempotencyKey: refundB,
        amountCents: 3_000,
      }),
      event("RECOVERY_RECONCILED", { refundIdempotencyKey: refundB }),
    ],
  };

  const result = analyzeOrderProfit({
    subtotalCents: 10_000,
    shippingCents: 0,
    taxCents: 0,
    totalCents: 10_000,
    currency: "usd",
    refunds: [
      { idempotencyKey: refundA, status: "succeeded", amountCents: 1_000, currency: "usd" },
      { idempotencyKey: refundB, status: "succeeded", amountCents: 1_000, currency: "usd" },
    ],
    payments: [authoritativePayment()],
    items: [{ id: "line-over", lineTotalCents: 10_000, procurementIntent: intent }],
  });

  assert.equal(result.recovery.aggregateOverAccountedIntentCount, 1);
  assert.equal(result.recovery.accountingValid, false);
  assert.equal(result.contribution.certified, false);
  assert.ok(result.contribution.finalizationReasons.includes("RECOVERY_ACCOUNTING_INVALID"));
});

test("payment and refund ledger anomalies fail closed", () => {
  const result = analyzeOrderProfit({
    subtotalCents: 10_000,
    shippingCents: 0,
    taxCents: 0,
    totalCents: 10_000,
    currency: "usd",
    refunds: [
      { idempotencyKey: "bad-refund-12345", status: "pending", amountCents: 11_000, currency: "usd" },
    ],
    payments: [{ ...authoritativePayment(), amountCents: 9_999 }],
    items: [
      {
        id: "line-ledger",
        lineTotalCents: 10_000,
        procurementIntent: {
          expectedTotalCostCents: 5_000,
          actualTotalCostCents: 5_000,
          quantity: 1,
          events: [],
        },
      },
    ],
  });

  assert.equal(result.integrity.refundLedgerValid, false);
  assert.equal(result.integrity.paymentLedgerValid, false);
  assert.ok(result.contribution.finalizationReasons.includes("REFUND_LEDGER_INVALID"));
  assert.ok(result.contribution.finalizationReasons.includes("PAYMENT_LEDGER_INVALID"));
});

test("admin operations route exposes read-only profit completeness without supplier automation", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/admin/commerce/orders/route.ts"),
    "utf8",
  );
  assert.match(source, /analyzeOrderProfit/);
  assert.match(source, /profitMetric/);
  assert.match(source, /certifiedContributionOrderCount/);
  assert.match(source, /incompleteContributionOrderCount/);
  assert.match(source, /automaticSupplierPurchasingEnabled: false/);
  assert.match(source, /automaticRecoveryEnabled: false/);
  assert.match(source, /events: \{/);
  assert.match(source, /take: 250/);
  assert.doesNotMatch(source, /export async function POST/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
});
