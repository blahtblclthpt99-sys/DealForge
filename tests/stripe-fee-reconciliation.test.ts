import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  mergeStripeFeeMeta,
  STRIPE_FEE_SOURCE,
  STRIPE_FEE_WEBHOOK_SOURCE,
  validateStripeFeeEvidence,
} from "../src/lib/stripe-fee-reconciliation";
import { authoritativePaymentFee } from "../src/lib/profit-analytics";

const charge = {
  id: "ch_fee_123",
  amount: 10_000,
  currency: "usd",
  status: "succeeded",
  payment_intent: "pi_fee_123",
  balance_transaction: "txn_fee_123",
};
const balanceTransaction = {
  id: "txn_fee_123",
  amount: 10_000,
  fee: 320,
  net: 9_680,
  currency: "usd",
  source: "ch_fee_123",
  type: "charge",
  reporting_category: "charge",
};

test("valid Stripe charge and balance transaction produce exact fee evidence", () => {
  const result = validateStripeFeeEvidence({
    paymentIntentId: "pi_fee_123",
    charge,
    balanceTransaction,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.evidence.feeCents, 320);
  assert.equal(result.evidence.grossCents, 10_000);
  assert.equal(result.evidence.netCents, 9_680);
  assert.equal(result.evidence.currency, "usd");
  assert.equal(result.evidence.chargeAmountCents, 10_000);
});

test("fee evidence rejects payment, balance-source, type, and arithmetic mismatches", () => {
  const wrongPayment = validateStripeFeeEvidence({
    paymentIntentId: "pi_other_123",
    charge,
    balanceTransaction,
  });
  assert.equal(wrongPayment.ok, false);

  const wrongSource = validateStripeFeeEvidence({
    paymentIntentId: "pi_fee_123",
    charge,
    balanceTransaction: { ...balanceTransaction, source: "ch_other_123" },
  });
  assert.deepEqual(wrongSource, { ok: false, reason: "STRIPE_FEE_BALANCE_SOURCE_MISMATCH" });

  const wrongType = validateStripeFeeEvidence({
    paymentIntentId: "pi_fee_123",
    charge,
    balanceTransaction: { ...balanceTransaction, type: "refund" },
  });
  assert.deepEqual(wrongType, { ok: false, reason: "STRIPE_FEE_BALANCE_TYPE_MISMATCH" });

  const wrongMath = validateStripeFeeEvidence({
    paymentIntentId: "pi_fee_123",
    charge,
    balanceTransaction: { ...balanceTransaction, net: 9_679 },
  });
  assert.deepEqual(wrongMath, { ok: false, reason: "STRIPE_FEE_BALANCE_MATH_MISMATCH" });
});

test("cross-currency settlement evidence is retained without pretending it is order currency", () => {
  const result = validateStripeFeeEvidence({
    paymentIntentId: "pi_fee_123",
    charge,
    balanceTransaction: {
      ...balanceTransaction,
      amount: 9_200,
      fee: 300,
      net: 8_900,
      currency: "eur",
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.evidence.chargeCurrency, "usd");
  assert.equal(result.evidence.currency, "eur");
});

test("fee metadata preserves unrelated metadata and rejects partial or conflicting fee evidence", () => {
  const validated = validateStripeFeeEvidence({
    paymentIntentId: "pi_fee_123",
    charge,
    balanceTransaction,
  });
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  const partialConflict = mergeStripeFeeMeta({
    currentMeta: JSON.stringify({ source: "stripe_webhook", processingFeeCents: 320 }),
    evidence: validated.evidence,
    source: STRIPE_FEE_WEBHOOK_SOURCE,
    reconciledAt: "2026-08-25T04:39:00.000Z",
  });
  assert.deepEqual(partialConflict, { ok: false, reason: "STRIPE_FEE_IMMUTABLE_MISMATCH" });

  const merged = mergeStripeFeeMeta({
    currentMeta: JSON.stringify({ source: "stripe_webhook", keep: "yes" }),
    evidence: validated.evidence,
    source: STRIPE_FEE_WEBHOOK_SOURCE,
    reconciledAt: "2026-08-25T04:40:00.000Z",
    eventId: "evt_fee_123",
  });
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  const meta = JSON.parse(merged.meta);
  assert.equal(meta.keep, "yes");
  assert.equal(meta.processingFeeCents, 320);
  assert.equal(meta.processingFeeSource, STRIPE_FEE_WEBHOOK_SOURCE);
  assert.equal(meta.processingFeeBalanceTransactionId, "txn_fee_123");

  const conflict = mergeStripeFeeMeta({
    currentMeta: merged.meta,
    evidence: { ...validated.evidence, feeCents: 321 },
    source: STRIPE_FEE_SOURCE,
    reconciledAt: "2026-08-25T04:41:00.000Z",
  });
  assert.deepEqual(conflict, { ok: false, reason: "STRIPE_FEE_IMMUTABLE_MISMATCH" });
});

test("profit analytics accepts only complete authoritative Stripe fee provenance", () => {
  const payment = {
    status: "succeeded",
    amountCents: 10_000,
    currency: "usd",
    meta: JSON.stringify({
      processingFeeCents: 320,
      processingFeeCurrency: "usd",
      processingFeeSource: STRIPE_FEE_WEBHOOK_SOURCE,
      processingFeeChargeId: "ch_fee_123",
      processingFeeBalanceTransactionId: "txn_fee_123",
      processingFeeGrossCents: 10_000,
      processingFeeNetCents: 9_680,
    }),
  };
  assert.equal(authoritativePaymentFee(payment)?.feeCents, 320);
  assert.equal(
    authoritativePaymentFee({
      ...payment,
      meta: JSON.stringify({
        processingFeeCents: 320,
        processingFeeCurrency: "usd",
        processingFeeSource: "estimated_percentage",
        processingFeeChargeId: "ch_fee_123",
        processingFeeBalanceTransactionId: "txn_fee_123",
        processingFeeGrossCents: 10_000,
        processingFeeNetCents: 9_680,
      }),
    }),
    null,
  );
});

test("Stripe helper requests nested balance-transaction evidence", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/lib/stripe-commerce.ts"), "utf8");
  assert.match(source, /latest_charge\.balance_transaction/);
  assert.match(source, /balance_transactions\/\$\{encodeURIComponent\(balanceTransactionId\)\}/);
  assert.match(source, /BALANCE_TRANSACTION_ID_INVALID/);
});

test("verified charge webhooks automatically reconcile fee evidence before event commit", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/stripe/webhook/route.ts"),
    "utf8",
  );
  assert.match(source, /case "charge\.succeeded"/);
  assert.match(source, /case "charge\.updated"/);
  assert.match(source, /retrieveStripeBalanceTransaction/);
  assert.match(source, /STRIPE_FEE_WEBHOOK_SOURCE/);
  assert.match(source, /const feeEvidence = await prepareStripeFeeEvidence\(event\)/);
  assert.match(source, /const result = await prisma\.\$transaction/);
  assert.ok(
    source.indexOf("prepareStripeFeeEvidence(event)") < source.indexOf("prisma.$transaction"),
    "fee evidence should be prepared before the event transaction is claimed",
  );
});

test("admin finance reconciliation provides a guarded backfill mutation", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/admin/finance/reconcile/route.ts"),
    "utf8",
  );
  assert.match(source, /requireAdmin/);
  assert.match(source, /export async function POST/);
  assert.match(source, /STRIPE_FEE_SOURCE/);
  assert.match(source, /updatedAt: payment\.updatedAt/);
  assert.match(source, /FEE_RECONCILIATION_CONCURRENT_CHANGE/);
  assert.match(source, /Cache-Control/);
});
