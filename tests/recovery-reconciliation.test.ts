import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  listRecoveryCases,
  projectRecoveryReconciliation,
  recoveryEventKey,
  recoveryRequestHash,
} from "../src/lib/recovery-reconciliation";

const refundKey = "refund-key-12345";

function event(type: string, detail: Record<string, unknown>) {
  return {
    type,
    detail: JSON.stringify(detail),
    createdAt: "2026-08-25T03:00:00.000Z",
  };
}

const exception = event("POST_PURCHASE_REFUND_EXCEPTION_APPROVED", {
  refundIdempotencyKey: refundKey,
  amountCents: 4000,
  recoveryPlan: "customer_return_required",
});

const succeededRefund = {
  idempotencyKey: refundKey,
  status: "succeeded",
  amountCents: 4000,
};

test("recovery closure reconciles supplier exposure, not customer refund amount", () => {
  const recovery = projectRecoveryReconciliation({
    events: [
      exception,
      event("CUSTOMER_RETURN_RECEIVED", { refundIdempotencyKey: refundKey, quantity: 2 }),
      event("SUPPLIER_RECOVERY_RECORDED", { refundIdempotencyKey: refundKey, amountCents: 5000 }),
      event("UNRECOVERED_LOSS_ACCEPTED", { refundIdempotencyKey: refundKey, amountCents: 2000 }),
    ],
    refund: succeededRefund,
    refundIdempotencyKey: refundKey,
    actualTotalCostCents: 7000,
    intentQuantity: 2,
  });
  assert.equal(recovery.ok, true);
  if (!recovery.ok) return;
  assert.equal(recovery.customerRefundAmountCents, 4000);
  assert.equal(recovery.targetSupplierExposureCents, 7000);
  assert.equal(recovery.supplierRecoveredCents, 5000);
  assert.equal(recovery.acceptedLossCents, 2000);
  assert.equal(recovery.remainingSupplierExposureCents, 0);
  assert.equal(recovery.canClose, true);
});

test("partial customer return cannot close a full quantity recovery", () => {
  const recovery = projectRecoveryReconciliation({
    events: [
      exception,
      event("CUSTOMER_RETURN_RECEIVED", { refundIdempotencyKey: refundKey, quantity: 1 }),
      event("SUPPLIER_RECOVERY_RECORDED", { refundIdempotencyKey: refundKey, amountCents: 7000 }),
    ],
    refund: succeededRefund,
    refundIdempotencyKey: refundKey,
    actualTotalCostCents: 7000,
    intentQuantity: 2,
  });
  assert.equal(recovery.ok, true);
  if (!recovery.ok) return;
  assert.equal(recovery.customerReturnedQuantity, 1);
  assert.equal(recovery.requiredEvidenceSatisfied, false);
  assert.equal(recovery.canClose, false);
});

test("supplier-return plan requires full supplier return quantity", () => {
  const supplierException = event("POST_PURCHASE_REFUND_EXCEPTION_APPROVED", {
    refundIdempotencyKey: refundKey,
    amountCents: 7000,
    recoveryPlan: "supplier_return_required",
  });
  const recovery = projectRecoveryReconciliation({
    events: [
      supplierException,
      event("SUPPLIER_RETURN_SENT", { refundIdempotencyKey: refundKey, quantity: 2 }),
      event("SUPPLIER_RECOVERY_RECORDED", { refundIdempotencyKey: refundKey, amountCents: 7000 }),
    ],
    refund: succeededRefund,
    refundIdempotencyKey: refundKey,
    actualTotalCostCents: 7000,
    intentQuantity: 2,
  });
  assert.equal(recovery.ok, true);
  if (!recovery.ok) return;
  assert.equal(recovery.supplierReturnSentQuantity, 2);
  assert.equal(recovery.requiredEvidenceSatisfied, true);
  assert.equal(recovery.canClose, true);
});

test("pending refund cannot be reconciled closed", () => {
  const recovery = projectRecoveryReconciliation({
    events: [
      exception,
      event("CUSTOMER_RETURN_RECEIVED", { refundIdempotencyKey: refundKey, quantity: 2 }),
      event("UNRECOVERED_LOSS_ACCEPTED", { refundIdempotencyKey: refundKey, amountCents: 7000 }),
    ],
    refund: { ...succeededRefund, status: "pending" },
    refundIdempotencyKey: refundKey,
    actualTotalCostCents: 7000,
    intentQuantity: 2,
  });
  assert.equal(recovery.ok, true);
  if (!recovery.ok) return;
  assert.equal(recovery.refundStatus, "pending");
  assert.equal(recovery.canClose, false);
});

test("over-accounted supplier exposure fails closed", () => {
  const recovery = projectRecoveryReconciliation({
    events: [
      exception,
      event("CUSTOMER_RETURN_RECEIVED", { refundIdempotencyKey: refundKey, quantity: 2 }),
      event("SUPPLIER_RECOVERY_RECORDED", { refundIdempotencyKey: refundKey, amountCents: 8000 }),
    ],
    refund: succeededRefund,
    refundIdempotencyKey: refundKey,
    actualTotalCostCents: 7000,
    intentQuantity: 2,
  });
  assert.equal(recovery.ok, true);
  if (!recovery.ok) return;
  assert.equal(recovery.overAccounted, true);
  assert.equal(recovery.canClose, false);
});

test("closed recovery is projected durably", () => {
  const recovery = projectRecoveryReconciliation({
    events: [
      exception,
      event("CUSTOMER_RETURN_RECEIVED", { refundIdempotencyKey: refundKey, quantity: 2 }),
      event("UNRECOVERED_LOSS_ACCEPTED", { refundIdempotencyKey: refundKey, amountCents: 7000 }),
      event("RECOVERY_RECONCILED", { refundIdempotencyKey: refundKey }),
    ],
    refund: succeededRefund,
    refundIdempotencyKey: refundKey,
    actualTotalCostCents: 7000,
    intentQuantity: 2,
  });
  assert.equal(recovery.ok, true);
  if (!recovery.ok) return;
  assert.equal(recovery.closed, true);
});

test("recovery event keys and request hashes are deterministic and bounded", () => {
  const first = recoveryEventKey("intent-1", refundKey, "SUPPLIER_RECOVERY_RECORDED", "credit-1");
  const second = recoveryEventKey("intent-1", refundKey, "SUPPLIER_RECOVERY_RECORDED", "credit-1");
  assert.equal(first, second);
  assert.ok(first.length < 100);
  assert.equal(recoveryRequestHash({ a: 1 }), recoveryRequestHash({ a: 1 }));
});

test("multiple post-purchase exceptions project as separate recovery cases", () => {
  const otherKey = "refund-key-67890";
  const cases = listRecoveryCases({
    events: [
      exception,
      event("POST_PURCHASE_REFUND_EXCEPTION_APPROVED", {
        refundIdempotencyKey: otherKey,
        amountCents: 1000,
        recoveryPlan: "supplier_cancel_requested",
      }),
    ],
    refunds: [
      succeededRefund,
      { idempotencyKey: otherKey, status: "pending", amountCents: 1000 },
    ],
    actualTotalCostCents: 7000,
    intentQuantity: 2,
  });
  assert.equal(cases.length, 2);
});

test("admin recovery route is bounded, admin-only, idempotent, and row-lock serialized", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/admin/procurement/[id]/recovery/route.ts"),
    "utf8",
  );
  assert.match(source, /requireAdmin/);
  assert.match(source, /readLimitedJson\(request, 16 \* 1024\)/);
  assert.match(source, /RECOVERY_LOSS_REQUIRES_SUCCEEDED_REFUND/);
  assert.match(source, /RECOVERY_ACCOUNTING_EXCEEDS_SUPPLIER_COST/);
  assert.match(source, /FOR UPDATE/);
  assert.doesNotMatch(source, /data: \{ updatedAt:/);
  assert.match(source, /RECOVERY_EVENT_HISTORY_LIMIT/);
  assert.match(source, /automaticRecoveryEnabled: false/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
});

test("procurement queue exposes recovery reconciliation without automation", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/admin/procurement/route.ts"),
    "utf8",
  );
  assert.match(source, /listRecoveryCases/);
  assert.match(source, /openCaseCount/);
  assert.match(source, /automaticRecoveryEnabled: false/);
});
