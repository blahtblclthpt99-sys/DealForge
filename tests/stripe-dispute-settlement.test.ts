import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeStripeDisputeSettlementMeta,
  readStripeDisputeSettlementDecision,
  validateStripeDisputeSettlementEvidence,
} from "../src/lib/stripe-dispute-settlement";
import { deriveFinancialOrderStatus, mergeStripeDisputeMeta } from "../src/lib/stripe-dispute-integrity";

const dispute = {
  id: "dp_settle123",
  payment_intent: "pi_settle123",
  charge: "ch_settle123",
  amount: 7000,
  currency: "usd",
};

function balance(id: string, amount: number, status = "available") {
  return {
    id,
    amount,
    fee: 0,
    net: amount,
    currency: "usd",
    source: "dp_settle123",
    status,
    type: "adjustment",
    reporting_category: "dispute",
  };
}

function disputeMeta(status: string) {
  const merged = mergeStripeDisputeMeta({
    currentMeta: "{}",
    dispute: {
      disputeId: "dp_settle123",
      paymentIntentId: "pi_settle123",
      chargeId: "ch_settle123",
      amountCents: 7000,
      currency: "usd",
      status,
      reason: "fraudulent",
    },
    eventId: "evt_dispute_status",
    eventType: status === "won" || status === "lost" ? "charge.dispute.closed" : "charge.dispute.updated",
    eventCreated: 1800000100,
    reconciledAt: "2026-08-26T19:00:00.000Z",
  });
  assert.equal(merged.ok, true);
  if (!merged.ok) throw new Error("unexpected dispute merge failure");
  return merged.meta;
}

test("valid withdrawal is bound to exact Stripe dispute and negative principal", () => {
  const result = validateStripeDisputeSettlementEvidence({
    dispute,
    balanceTransaction: balance("txn_withdraw123", -7000),
    kind: "funds_withdrawn",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.evidence.source, dispute.id);
  assert.equal(result.evidence.amountCents, -7000);
});

test("valid reinstatement is positive and must match exact dispute principal", () => {
  const result = validateStripeDisputeSettlementEvidence({
    dispute,
    balanceTransaction: balance("txn_reinstate123", 7000),
    kind: "funds_reinstated",
  });
  assert.equal(result.ok, true);
});

test("wrong source, currency, amount, sign, or balance math fails closed", () => {
  const wrongSource = { ...balance("txn_badsource", -7000), source: "dp_other123" };
  const wrongCurrency = { ...balance("txn_badcurrency", -7000), currency: "eur" };
  const wrongAmount = balance("txn_badamount", -6999);
  const wrongSign = balance("txn_badsign", 7000);
  const wrongMath = { ...balance("txn_badmath", -7000), fee: 10, net: -7000 };

  assert.equal(validateStripeDisputeSettlementEvidence({ dispute, balanceTransaction: wrongSource, kind: "funds_withdrawn" }).ok, false);
  assert.equal(validateStripeDisputeSettlementEvidence({ dispute, balanceTransaction: wrongCurrency, kind: "funds_withdrawn" }).ok, false);
  assert.equal(validateStripeDisputeSettlementEvidence({ dispute, balanceTransaction: wrongAmount, kind: "funds_withdrawn" }).ok, false);
  assert.equal(validateStripeDisputeSettlementEvidence({ dispute, balanceTransaction: wrongSign, kind: "funds_withdrawn" }).ok, false);
  assert.equal(validateStripeDisputeSettlementEvidence({ dispute, balanceTransaction: wrongMath, kind: "funds_withdrawn" }).ok, false);
});

test("won dispute remains blocked after withdrawal and before available reinstatement", () => {
  const validated = validateStripeDisputeSettlementEvidence({
    dispute,
    balanceTransaction: balance("txn_withdraw456", -7000),
    kind: "funds_withdrawn",
  });
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  const merged = mergeStripeDisputeSettlementMeta({
    currentMeta: disputeMeta("won"),
    evidence: validated.evidence,
    eventId: "evt_funds_withdrawn",
    eventType: "charge.dispute.funds_withdrawn",
    eventCreated: 1800000200,
    reconciledAt: "2026-08-26T19:01:00.000Z",
  });
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  const state = deriveFinancialOrderStatus({ paymentMeta: merged.meta, succeededRefundCents: 0, totalCents: 7000 });
  assert.equal(state.ok && state.status, "payment_disputed");
});

test("pending reinstatement does not restore paid state", () => {
  const validated = validateStripeDisputeSettlementEvidence({
    dispute,
    balanceTransaction: balance("txn_pending123", 7000, "pending"),
    kind: "funds_reinstated",
  });
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  const merged = mergeStripeDisputeSettlementMeta({
    currentMeta: disputeMeta("won"),
    evidence: validated.evidence,
    eventId: "evt_funds_pending",
    eventType: "charge.dispute.funds_reinstated",
    eventCreated: 1800000300,
    reconciledAt: "2026-08-26T19:02:00.000Z",
  });
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  const state = deriveFinancialOrderStatus({ paymentMeta: merged.meta, succeededRefundCents: 0, totalCents: 7000 });
  assert.equal(state.ok && state.status, "payment_disputed");
});

test("available reinstatement allows a won dispute to restore financial state", () => {
  const validated = validateStripeDisputeSettlementEvidence({
    dispute,
    balanceTransaction: balance("txn_reinstate456", 7000),
    kind: "funds_reinstated",
  });
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  const merged = mergeStripeDisputeSettlementMeta({
    currentMeta: disputeMeta("won"),
    evidence: validated.evidence,
    eventId: "evt_funds_reinstated",
    eventType: "charge.dispute.funds_reinstated",
    eventCreated: 1800000400,
    reconciledAt: "2026-08-26T19:03:00.000Z",
  });
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  const settlement = readStripeDisputeSettlementDecision(merged.meta);
  assert.equal(settlement.ok, true);
  if (settlement.ok) assert.deepEqual(settlement.reinstatedDisputeIds, [dispute.id]);
  const state = deriveFinancialOrderStatus({ paymentMeta: merged.meta, succeededRefundCents: 0, totalCents: 7000 });
  assert.equal(state.ok && state.status, "paid");
});

test("conflicting duplicate settlement movement fails closed", () => {
  const firstValidated = validateStripeDisputeSettlementEvidence({
    dispute,
    balanceTransaction: balance("txn_withdraw789", -7000),
    kind: "funds_withdrawn",
  });
  assert.equal(firstValidated.ok, true);
  if (!firstValidated.ok) return;
  const first = mergeStripeDisputeSettlementMeta({
    currentMeta: disputeMeta("needs_response"),
    evidence: firstValidated.evidence,
    eventId: "evt_withdraw_first",
    eventType: "charge.dispute.funds_withdrawn",
    eventCreated: 1800000500,
    reconciledAt: "2026-08-26T19:04:00.000Z",
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const secondValidated = validateStripeDisputeSettlementEvidence({
    dispute,
    balanceTransaction: balance("txn_withdraw_other", -7000),
    kind: "funds_withdrawn",
  });
  assert.equal(secondValidated.ok, true);
  if (!secondValidated.ok) return;
  const conflict = mergeStripeDisputeSettlementMeta({
    currentMeta: first.meta,
    evidence: secondValidated.evidence,
    eventId: "evt_withdraw_second",
    eventType: "charge.dispute.funds_withdrawn",
    eventCreated: 1800000600,
    reconciledAt: "2026-08-26T19:05:00.000Z",
  });
  assert.equal(conflict.ok, false);
});
