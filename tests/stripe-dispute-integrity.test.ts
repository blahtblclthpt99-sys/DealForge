import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveFinancialOrderStatus,
  mergeStripeDisputeMeta,
  readStripeDisputeDecision,
  type StripeDisputeSnapshot,
} from "../src/lib/stripe-dispute-integrity";

const baseDispute: StripeDisputeSnapshot = {
  disputeId: "dp_test123",
  paymentIntentId: "pi_test123",
  chargeId: "ch_test123",
  amountCents: 7_000,
  currency: "usd",
  status: "needs_response",
  reason: "fraudulent",
};

function merge(
  currentMeta: string,
  dispute: StripeDisputeSnapshot,
  eventId: string,
  eventType: "charge.dispute.created" | "charge.dispute.updated" | "charge.dispute.closed",
  eventCreated: number,
) {
  return mergeStripeDisputeMeta({
    currentMeta,
    dispute,
    eventId,
    eventType,
    eventCreated,
    reconciledAt: "2026-08-26T18:00:00.000Z",
  });
}

test("active Stripe dispute changes financial order state to payment_disputed", () => {
  const result = merge("{}", baseDispute, "evt_dispute_created", "charge.dispute.created", 1_800_000_000);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.disposition, "active");
  assert.deepEqual(result.activeDisputeIds, [baseDispute.disputeId]);

  const state = deriveFinancialOrderStatus({
    paymentMeta: result.meta,
    succeededRefundCents: 0,
    totalCents: 7_000,
  });
  assert.deepEqual(state.ok && state.status, "payment_disputed");
});

test("won dispute restores paid state only after the dispute ledger is clear", () => {
  const created = merge("{}", baseDispute, "evt_dispute_created", "charge.dispute.created", 1_800_000_000);
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const won = merge(
    created.meta,
    { ...baseDispute, status: "won" },
    "evt_dispute_closed",
    "charge.dispute.closed",
    1_800_000_100,
  );
  assert.equal(won.ok, true);
  if (!won.ok) return;
  assert.equal(won.disposition, "clear");

  const state = deriveFinancialOrderStatus({
    paymentMeta: won.meta,
    succeededRefundCents: 0,
    totalCents: 7_000,
  });
  assert.deepEqual(state.ok && state.status, "paid");
});

test("lost dispute is a terminal financial loss state", () => {
  const lost = merge(
    "{}",
    { ...baseDispute, status: "lost" },
    "evt_dispute_lost",
    "charge.dispute.closed",
    1_800_000_000,
  );
  assert.equal(lost.ok, true);
  if (!lost.ok) return;

  const state = deriveFinancialOrderStatus({
    paymentMeta: lost.meta,
    succeededRefundCents: 0,
    totalCents: 7_000,
  });
  assert.deepEqual(state.ok && state.status, "payment_dispute_lost");
});

test("unknown future dispute statuses fail closed as active", () => {
  const result = merge(
    "{}",
    { ...baseDispute, status: "future_network_review" },
    "evt_future_status",
    "charge.dispute.updated",
    1_800_000_000,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.disposition, "active");
});

test("one resolved dispute cannot clear another active dispute", () => {
  const first = merge("{}", baseDispute, "evt_first", "charge.dispute.created", 1_800_000_000);
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const secondDispute: StripeDisputeSnapshot = {
    ...baseDispute,
    disputeId: "dp_test456",
    chargeId: "ch_test456",
    amountCents: 1_000,
  };
  const second = merge(first.meta, secondDispute, "evt_second", "charge.dispute.created", 1_800_000_010);
  assert.equal(second.ok, true);
  if (!second.ok) return;

  const firstWon = merge(
    second.meta,
    { ...baseDispute, status: "won" },
    "evt_first_won",
    "charge.dispute.closed",
    1_800_000_020,
  );
  assert.equal(firstWon.ok, true);
  if (!firstWon.ok) return;
  assert.equal(firstWon.disposition, "active");
  assert.deepEqual(firstWon.activeDisputeIds, [secondDispute.disputeId]);
});

test("stale dispute event cannot regress newer authoritative state", () => {
  const newer = merge(
    "{}",
    { ...baseDispute, status: "under_review" },
    "evt_newer",
    "charge.dispute.updated",
    1_800_000_100,
  );
  assert.equal(newer.ok, true);
  if (!newer.ok) return;

  const stale = merge(
    newer.meta,
    { ...baseDispute, status: "needs_response" },
    "evt_stale",
    "charge.dispute.updated",
    1_800_000_000,
  );
  assert.equal(stale.ok, true);
  if (!stale.ok) return;
  assert.equal(stale.stale, true);
  assert.equal(stale.meta, newer.meta);
});

test("immutable dispute economics and bindings cannot drift", () => {
  const created = merge("{}", baseDispute, "evt_created", "charge.dispute.created", 1_800_000_000);
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const drift = merge(
    created.meta,
    { ...baseDispute, amountCents: baseDispute.amountCents + 1 },
    "evt_drift",
    "charge.dispute.updated",
    1_800_000_100,
  );
  assert.deepEqual(drift, { ok: false, reason: "STRIPE_DISPUTE_IMMUTABLE_FIELD_MISMATCH" });
});

test("terminal dispute state cannot be rewritten to a conflicting outcome", () => {
  const won = merge(
    "{}",
    { ...baseDispute, status: "won" },
    "evt_won",
    "charge.dispute.closed",
    1_800_000_000,
  );
  assert.equal(won.ok, true);
  if (!won.ok) return;

  const conflicting = merge(
    won.meta,
    { ...baseDispute, status: "lost" },
    "evt_conflict",
    "charge.dispute.closed",
    1_800_000_100,
  );
  assert.deepEqual(conflicting, { ok: false, reason: "STRIPE_DISPUTE_TERMINAL_STATE_CONFLICT" });
});

test("dispute ledger preserves unrelated payment metadata", () => {
  const current = JSON.stringify({ source: "stripe_webhook", feeV1: { feeCents: 210 } });
  const result = merge(current, baseDispute, "evt_preserve", "charge.dispute.created", 1_800_000_000);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const parsed = JSON.parse(result.meta) as Record<string, unknown>;
  assert.equal(parsed.source, "stripe_webhook");
  assert.deepEqual(parsed.feeV1, { feeCents: 210 });
});

test("refund state is restored after a dispute is safely resolved", () => {
  const created = merge("{}", baseDispute, "evt_created", "charge.dispute.created", 1_800_000_000);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const won = merge(
    created.meta,
    { ...baseDispute, status: "won" },
    "evt_won",
    "charge.dispute.closed",
    1_800_000_100,
  );
  assert.equal(won.ok, true);
  if (!won.ok) return;

  const partial = deriveFinancialOrderStatus({
    paymentMeta: won.meta,
    succeededRefundCents: 2_000,
    totalCents: 7_000,
  });
  assert.deepEqual(partial.ok && partial.status, "partially_refunded");

  const full = deriveFinancialOrderStatus({
    paymentMeta: won.meta,
    succeededRefundCents: 7_000,
    totalCents: 7_000,
  });
  assert.deepEqual(full.ok && full.status, "refunded");
});

test("corrupt dispute metadata fails closed", () => {
  const decision = readStripeDisputeDecision(
    JSON.stringify({ stripeDisputesV1: { version: 1, entries: { dp_bad: { status: "won" } } } }),
  );
  assert.deepEqual(decision, { ok: false, reason: "PAYMENT_DISPUTE_META_INVALID" });

  const state = deriveFinancialOrderStatus({
    paymentMeta: "not-json",
    succeededRefundCents: 0,
    totalCents: 7_000,
  });
  assert.deepEqual(state, { ok: false, reason: "PAYMENT_META_INVALID" });
});
