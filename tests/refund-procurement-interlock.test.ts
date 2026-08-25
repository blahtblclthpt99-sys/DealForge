import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  evaluateRefundProcurementInterlock,
  hasActiveRefund,
  postPurchaseRefundExceptionEventKey,
  refundInterlockEventKey,
  validatePostPurchaseRefundException,
} from "../src/lib/refund-procurement-interlock";

test("pre-purchase procurement can be placed on refund hold", () => {
  const result = evaluateRefundProcurementInterlock([
    { id: "a", status: "awaiting_review" },
    { id: "b", status: "approved_manual" },
    { id: "c", status: "hold" },
  ]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.holdIntentIds, ["a", "b"]);
    assert.deepEqual(result.exceptionIntentIds, []);
  }
});

test("refund after supplier purchase requires explicit exception", () => {
  for (const status of ["supplier_ordered_manual", "shipped", "delivered"]) {
    const result = evaluateRefundProcurementInterlock([{ id: "p", status }]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "POST_PURCHASE_EXCEPTION_REQUIRED");
  }
});

test("post-purchase exception requires loss acknowledgement when customer keeps item", () => {
  const result = validatePostPurchaseRefundException(
    {
      acknowledgeIrreversibleFulfillment: true,
      recoveryPlan: "customer_keep_accept_loss",
      note: "Owner approves refund after reviewing recovery economics.",
    },
    [{ id: "p", status: "shipped" }],
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "POST_PURCHASE_LOSS_ACK_REQUIRED");
});

test("audited recovery plan can authorize post-purchase refund exception", () => {
  const result = evaluateRefundProcurementInterlock(
    [{ id: "p", status: "shipped" }],
    {
      acknowledgeIrreversibleFulfillment: true,
      recoveryPlan: "customer_return_required",
      note: "Customer return is required and will be reconciled manually.",
    },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.holdIntentIds, []);
    assert.deepEqual(result.exceptionIntentIds, ["p"]);
  }
});

test("customer-keep loss exception requires explicit loss acceptance", () => {
  const result = evaluateRefundProcurementInterlock(
    [{ id: "p", status: "delivered" }],
    {
      acknowledgeIrreversibleFulfillment: true,
      recoveryPlan: "customer_keep_accept_loss",
      acceptUnrecoveredLoss: true,
      note: "Owner accepts unrecovered supplier cost for this exception.",
    },
  );
  assert.equal(result.ok, true);
});

test("unknown procurement states fail closed", () => {
  const result = evaluateRefundProcurementInterlock([{ id: "p", status: "mystery" }]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "REFUND_PROCUREMENT_STATE_UNSAFE");
});

test("pending and succeeded refunds block procurement advancement", () => {
  assert.equal(hasActiveRefund([{ status: "pending" }]), true);
  assert.equal(hasActiveRefund([{ status: "succeeded" }]), true);
  assert.equal(hasActiveRefund([{ status: "failed" }]), false);
});

test("refund interlock event keys are deterministic per intent and refund key", () => {
  assert.equal(
    refundInterlockEventKey("intent-1", "refund-key-1"),
    "refund-interlock:intent-1:refund-key-1",
  );
  assert.equal(
    postPurchaseRefundExceptionEventKey("intent-1", "refund-key-1"),
    "refund-post-purchase-exception:intent-1:refund-key-1",
  );
});

test("refund route freezes procurement or journals exception before Stripe network call", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/app/api/admin/refunds/route.ts"), "utf8");
  const holdIndex = source.indexOf("REFUND_INTERLOCK_HOLD");
  const exceptionIndex = source.indexOf("POST_PURCHASE_REFUND_EXCEPTION_APPROVED");
  const stripeIndex = source.indexOf("createStripeRefund({");
  assert.ok(holdIndex >= 0);
  assert.ok(exceptionIndex >= 0);
  assert.ok(stripeIndex > holdIndex);
  assert.ok(stripeIndex > exceptionIndex);
  assert.match(source, /procurementIntents: true/);
  assert.match(source, /automaticRecoveryEnabled: false/);
  assert.match(source, /acknowledgeIrreversibleFulfillment/);
});

test("procurement route checks active refund both before and inside transaction", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/admin/procurement/[id]/route.ts"),
    "utf8",
  );
  const matches = source.match(/hasActiveRefund\(/g) || [];
  assert.ok(matches.length >= 2);
  assert.match(source, /PROCUREMENT_BLOCKED_BY_REFUND/);
  assert.match(source, /PROCUREMENT_REFUND_INTERLOCK/);
});
