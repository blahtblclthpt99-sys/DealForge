import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relative: string) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

test("post-purchase exception actions remain admin-only and evidence-bound", () => {
  const source = read("src/app/api/admin/procurement/[id]/exception/route.ts");
  assert.match(source, /requireAdmin/);
  assert.match(source, /manualEvidenceConfirmed: z\.literal\(true\)/);
  assert.match(source, /refundIdempotencyKey/);
  assert.match(source, /acceptUnrecoveredSupplierCost/);
  assert.match(source, /validatePostPurchaseRecovery/);
  assert.match(source, /executionMode !== "manual_only"/);
  assert.match(source, /updateMany/);
});

test("refund route requires exact post-purchase allocations and clearance", () => {
  const source = read("src/app/api/admin/refunds/route.ts");
  assert.match(source, /postPurchaseAllocations/);
  assert.match(source, /findPostPurchaseRefundClearance/);
  assert.match(source, /POST_PURCHASE_REFUND_ALLOCATION_TOTAL_MISMATCH/);
  assert.match(source, /POST_PURCHASE_REFUND_CLEARANCE_MISMATCH/);
  assert.match(source, /postPurchaseRefundExecutionEventKey/);
  assert.match(source, /readLimitedJson\(request, 16 \* 1024\)/);
  assert.match(source, /stripeRefund\.amount !== parsed\.data\.amountCents/);
});

test("shipment endpoint blocks active refunds and open post-purchase exceptions", () => {
  const source = read("src/app/api/admin/procurement/[id]/shipment/route.ts");
  assert.match(source, /hasActiveRefund\(current\.order\.refunds\)/);
  assert.match(source, /SHIPMENT_BLOCKED_BY_ACTIVE_REFUND/);
  assert.match(source, /hasActivePostPurchaseException\(current\.events\)/);
  assert.match(source, /SHIPMENT_BLOCKED_BY_POST_PURCHASE_EXCEPTION/);
});
