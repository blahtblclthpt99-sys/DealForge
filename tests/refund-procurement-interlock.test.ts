import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  evaluateRefundProcurementInterlock,
  hasActiveRefund,
  refundInterlockEventKey,
} from "../src/lib/refund-procurement-interlock";

test("pre-purchase procurement can be placed on refund hold", () => {
  const result = evaluateRefundProcurementInterlock([
    { id: "a", status: "awaiting_review" },
    { id: "b", status: "approved_manual" },
    { id: "c", status: "hold" },
  ]);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.holdIntentIds, ["a", "b"]);
});

test("refund is blocked after supplier purchase or shipment", () => {
  for (const status of ["supplier_ordered_manual", "shipped", "delivered"]) {
    const result = evaluateRefundProcurementInterlock([{ id: "p", status }]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "REFUND_BLOCKED_AFTER_SUPPLIER_PURCHASE");
  }
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
});

test("refund route freezes procurement before Stripe network call", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/app/api/admin/refunds/route.ts"), "utf8");
  const holdIndex = source.indexOf("REFUND_INTERLOCK_HOLD");
  const stripeIndex = source.indexOf("createStripeRefund({");
  assert.ok(holdIndex >= 0);
  assert.ok(stripeIndex > holdIndex);
  assert.match(source, /procurementIntents: true/);
  assert.match(source, /updateMany\(\{/);
  assert.match(source, /status: \"hold\"/);
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
