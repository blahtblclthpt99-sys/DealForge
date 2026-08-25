import test from "node:test";
import assert from "node:assert/strict";
import {
  findPostPurchaseRefundClearance,
  hasActivePostPurchaseException,
  validatePostPurchaseRecovery,
} from "../src/lib/post-purchase-exceptions";

test("unrecovered supplier cost requires explicit acknowledgement", () => {
  const result = validatePostPurchaseRecovery({
    actualSupplierCostCents: 7000,
    supplierRecoveryCents: 5000,
    authorizedCustomerRefundCents: 8000,
    lineRevenueCents: 10000,
    acceptUnrecoveredSupplierCost: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "UNRECOVERED_SUPPLIER_COST_REQUIRES_ACKNOWLEDGEMENT");
    assert.equal(result.unrecoveredSupplierCostCents, 2000);
  }
});

test("acknowledged supplier loss returns explicit exposure", () => {
  const result = validatePostPurchaseRecovery({
    actualSupplierCostCents: 7000,
    supplierRecoveryCents: 5000,
    authorizedCustomerRefundCents: 8000,
    lineRevenueCents: 10000,
    acceptUnrecoveredSupplierCost: true,
  });
  assert.deepEqual(result, {
    ok: true,
    unrecoveredSupplierCostCents: 2000,
    projectedExceptionLossCents: 0,
  });
});

test("supplier recovery cannot exceed recorded actual supplier cost", () => {
  const result = validatePostPurchaseRecovery({
    actualSupplierCostCents: 7000,
    supplierRecoveryCents: 7001,
    authorizedCustomerRefundCents: 1000,
    lineRevenueCents: 10000,
    acceptUnrecoveredSupplierCost: true,
  });
  assert.deepEqual(result, { ok: false, reason: "SUPPLIER_RECOVERY_INVALID" });
});

test("post-purchase exception remains active until explicitly closed", () => {
  const open = [
    { type: "OPEN_POST_PURCHASE_EXCEPTION", detail: "{}" },
    { type: "AUTHORIZE_POST_PURCHASE_REFUND", detail: "{}" },
  ];
  assert.equal(hasActivePostPurchaseException(open), true);
  assert.equal(
    hasActivePostPurchaseException([
      ...open,
      { type: "CLOSE_POST_PURCHASE_EXCEPTION", detail: "{}" },
    ]),
    false,
  );
});

test("refund clearance is bound to exact key and active exception", () => {
  const detail = JSON.stringify({
    version: 1,
    manualEvidenceConfirmed: true,
    evidenceType: "supplier_credit_confirmed",
    evidenceReference: "CREDIT-123",
    supplierRecoveryCents: 6000,
    unrecoveredSupplierCostCents: 1000,
    authorizedCustomerRefundCents: 8000,
    refundIdempotencyKey: "refund:exception:123",
  });
  const events = [
    { type: "OPEN_POST_PURCHASE_EXCEPTION", detail: "{}" },
    { type: "AUTHORIZE_POST_PURCHASE_REFUND", detail },
  ];

  assert.deepEqual(findPostPurchaseRefundClearance(events, "refund:exception:123"), {
    refundIdempotencyKey: "refund:exception:123",
    authorizedCustomerRefundCents: 8000,
    evidenceType: "supplier_credit_confirmed",
    evidenceReference: "CREDIT-123",
    supplierRecoveryCents: 6000,
    unrecoveredSupplierCostCents: 1000,
  });
  assert.equal(findPostPurchaseRefundClearance(events, "refund:exception:other"), null);
  assert.equal(
    findPostPurchaseRefundClearance(
      [...events, { type: "CLOSE_POST_PURCHASE_EXCEPTION", detail: "{}" }],
      "refund:exception:123",
    ),
    null,
  );
});
