import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  refundFinancialEventKey,
  validateRefundFinancialEvidence,
} from "../src/lib/refund-financial-reconciliation";
import { analyzeOrderProfit } from "../src/lib/profit-analytics";

const stripeRefund = {
  id: "re_fin_123",
  payment_intent: "pi_fin_123",
  amount: 2_000,
  currency: "usd",
  status: "succeeded",
  balance_transaction: "txn_refund_123",
};

const refundBalance = {
  id: "txn_refund_123",
  amount: -2_000,
  fee: 50,
  net: -2_050,
  currency: "usd",
  source: "re_fin_123",
  type: "refund",
  reporting_category: "refund",
};

function payment() {
  return {
    status: "succeeded",
    amountCents: 10_000,
    currency: "usd",
    meta: JSON.stringify({
      source: "stripe_webhook",
      processingFeeCents: 300,
      processingFeeCurrency: "usd",
      processingFeeSource: "stripe_balance_transaction",
      processingFeeChargeId: "ch_fin_123",
      processingFeeBalanceTransactionId: "txn_charge_123",
      processingFeeGrossCents: 10_000,
      processingFeeNetCents: 9_700,
    }),
  };
}

function item(actualTotalCostCents = 4_000) {
  return {
    id: "line-fin-1",
    lineTotalCents: 10_000,
    procurementIntent: {
      expectedTotalCostCents: actualTotalCostCents,
      actualTotalCostCents,
      quantity: 1,
      events: [],
    },
  };
}

function succeededRefundWithEvidence(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: "refund-fin-key-123",
    status: "succeeded",
    amountCents: 2_000,
    currency: "usd",
    financialEvents: [
      {
        kind: "refund_balance",
        amountCents: -2_000,
        feeCents: 50,
        netCents: -2_050,
        currency: "usd",
        transactionType: "refund",
        balanceTransactionId: "txn_refund_123",
        ...overrides,
      },
    ],
  };
}

test("Stripe refund balance transaction validates as immutable financial evidence", () => {
  const result = validateRefundFinancialEvidence({
    refund: stripeRefund,
    balanceTransaction: refundBalance,
    kind: "refund_balance",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.evidence.amountCents, -2_000);
  assert.equal(result.evidence.feeCents, 50);
  assert.equal(result.evidence.netCents, -2_050);
  assert.equal(result.evidence.paymentIntentId, "pi_fin_123");
  assert.equal(
    refundFinancialEventKey(result.evidence),
    "refund-financial:re_fin_123:refund_balance:txn_refund_123",
  );
});

test("refund financial validation rejects source, amount, direction, type, and net mismatches", () => {
  const wrongSource = validateRefundFinancialEvidence({
    refund: stripeRefund,
    balanceTransaction: { ...refundBalance, source: "re_other_123" },
    kind: "refund_balance",
  });
  assert.deepEqual(wrongSource, { ok: false, reason: "REFUND_FINANCIAL_SOURCE_MISMATCH" });

  const wrongAmount = validateRefundFinancialEvidence({
    refund: stripeRefund,
    balanceTransaction: { ...refundBalance, amount: -1_999, net: -2_049 },
    kind: "refund_balance",
  });
  assert.deepEqual(wrongAmount, { ok: false, reason: "REFUND_FINANCIAL_REFUND_AMOUNT_MISMATCH" });

  const wrongDirection = validateRefundFinancialEvidence({
    refund: stripeRefund,
    balanceTransaction: { ...refundBalance, amount: 2_000, net: 1_950 },
    kind: "refund_balance",
  });
  assert.deepEqual(wrongDirection, { ok: false, reason: "REFUND_FINANCIAL_REFUND_DIRECTION_INVALID" });

  const wrongType = validateRefundFinancialEvidence({
    refund: stripeRefund,
    balanceTransaction: { ...refundBalance, type: "charge" },
    kind: "refund_balance",
  });
  assert.deepEqual(wrongType, { ok: false, reason: "REFUND_FINANCIAL_TRANSACTION_TYPE_INVALID" });

  const wrongNet = validateRefundFinancialEvidence({
    refund: stripeRefund,
    balanceTransaction: { ...refundBalance, net: -2_049 },
    kind: "refund_balance",
  });
  assert.deepEqual(wrongNet, { ok: false, reason: "REFUND_FINANCIAL_BALANCE_EVIDENCE_INVALID" });
});

test("failed refund reversal validates separately and cannot masquerade as a succeeded refund debit", () => {
  const failedRefund = {
    ...stripeRefund,
    status: "failed",
    failure_balance_transaction: "txn_failure_123",
  };
  const failureBalance = {
    id: "txn_failure_123",
    amount: 2_000,
    fee: 0,
    net: 2_000,
    currency: "usd",
    source: "re_fin_123",
    type: "refund_failure",
    reporting_category: "refund",
  };
  const result = validateRefundFinancialEvidence({
    refund: failedRefund,
    balanceTransaction: failureBalance,
    kind: "refund_failure_balance",
  });
  assert.equal(result.ok, true);

  const notFailed = validateRefundFinancialEvidence({
    refund: { ...stripeRefund, failure_balance_transaction: "txn_failure_123" },
    balanceTransaction: failureBalance,
    kind: "refund_failure_balance",
  });
  assert.deepEqual(notFailed, { ok: false, reason: "REFUND_FINANCIAL_FAILURE_STATUS_INVALID" });
});

test("reconciled refund fee is counted once while refund principal only reduces receipts", () => {
  const result = analyzeOrderProfit({
    subtotalCents: 10_000,
    shippingCents: 0,
    taxCents: 0,
    totalCents: 10_000,
    currency: "usd",
    refunds: [succeededRefundWithEvidence()],
    payments: [payment()],
    items: [item()],
  });

  assert.equal(result.receipts.netCustomerReceiptsCents, 8_000);
  assert.equal(result.paymentProcessing.chargeFeeCents, 300);
  assert.equal(result.paymentProcessing.refundFeeCents, 50);
  assert.equal(result.paymentProcessing.knownFeeCents, 350);
  assert.equal(result.paymentProcessing.refundAdjustmentComplete, true);
  assert.equal(result.contribution.certified, true);
  assert.equal(result.contribution.certifiedOrderContributionCents, 3_650);
});

test("missing, cross-currency, or duplicate refund financial evidence fails certification closed", () => {
  const base = {
    subtotalCents: 10_000,
    shippingCents: 0,
    taxCents: 0,
    totalCents: 10_000,
    currency: "usd",
    payments: [payment()],
    items: [item()],
  };

  const missing = analyzeOrderProfit({
    ...base,
    refunds: [{ ...succeededRefundWithEvidence(), financialEvents: [] }],
  });
  assert.equal(missing.contribution.certified, false);
  assert.ok(missing.contribution.finalizationReasons.includes("REFUND_PROCESSING_ADJUSTMENT_UNKNOWN"));

  const crossCurrency = analyzeOrderProfit({
    ...base,
    refunds: [succeededRefundWithEvidence({ currency: "eur" })],
  });
  assert.equal(crossCurrency.contribution.certified, false);

  const duplicate = analyzeOrderProfit({
    ...base,
    refunds: [
      {
        ...succeededRefundWithEvidence(),
        financialEvents: [
          ...succeededRefundWithEvidence().financialEvents,
          ...succeededRefundWithEvidence().financialEvents,
        ],
      },
    ],
  });
  assert.equal(duplicate.contribution.certified, false);
});

test("failed refund always requires manual financial review", () => {
  const result = analyzeOrderProfit({
    subtotalCents: 10_000,
    shippingCents: 0,
    taxCents: 0,
    totalCents: 10_000,
    currency: "usd",
    refunds: [
      {
        idempotencyKey: "refund-failed-key-123",
        status: "failed",
        amountCents: 2_000,
        currency: "usd",
        financialEvents: [],
      },
    ],
    payments: [payment()],
    items: [item()],
  });
  assert.equal(result.contribution.certified, false);
  assert.ok(result.contribution.finalizationReasons.includes("REFUND_FAILED_REQUIRES_MANUAL_REVIEW"));
});

test("tax remains a separate certification gate after refund balance reconciliation", () => {
  const result = analyzeOrderProfit({
    subtotalCents: 9_000,
    shippingCents: 0,
    taxCents: 1_000,
    totalCents: 10_000,
    currency: "usd",
    refunds: [succeededRefundWithEvidence()],
    payments: [payment()],
    items: [item()],
  });
  assert.equal(result.paymentProcessing.refundAdjustmentComplete, true);
  assert.equal(result.tax.complete, false);
  assert.equal(result.contribution.certified, false);
  assert.ok(result.contribution.finalizationReasons.includes("REFUND_TAX_ALLOCATION_UNKNOWN"));
});

test("migration and webhook preserve refund financial idempotency and retryability", () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), "prisma/migrations/20260825053000_refund_financial_reconciliation_v1/migration.sql"),
    "utf8",
  );
  assert.match(migration, /RefundFinancialEvent_providerBalanceTransactionId_key/);
  assert.match(migration, /REFERENCES "Refund"\("id"\)/);

  const webhook = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/stripe/webhook/route.ts"),
    "utf8",
  );
  assert.match(webhook, /prepareRefundFinancialEvidence/);
  assert.match(webhook, /persistRefundFinancialEvidence/);
  assert.match(webhook, /refund\.created/);
  assert.match(webhook, /refund\.failed/);
  assert.ok(
    webhook.indexOf("prepareRefundFinancialEvidence(event)") < webhook.indexOf("prisma.$transaction"),
    "refund financial evidence must be fetched before event claim",
  );
});

test("admin reconciliation backfills evidence without mutating Stripe-derived refund status", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/admin/finance/reconcile/route.ts"),
    "utf8",
  );
  assert.match(source, /retrieveStripeRefund/);
  assert.match(source, /refundIsFinanciallyComplete/);
  assert.match(source, /REFUND_FINANCIAL_EVIDENCE_INCOMPLETE/);
  assert.match(source, /local\.status !== stripeStatus/);
  assert.doesNotMatch(source, /tx\.refund\.update/);
});
