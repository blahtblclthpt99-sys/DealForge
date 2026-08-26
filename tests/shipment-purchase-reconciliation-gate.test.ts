import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const route = readFileSync(
  join(root, "src/app/api/admin/procurement/[id]/shipment/route.ts"),
  "utf8",
);

test("shipment fulfillment gate reconciles purchase evidence inside the mutation transaction", () => {
  assert.match(route, /prisma\.\$transaction/);
  assert.match(route, /reconcileManualPurchaseProjection/);
  assert.match(route, /RECORD_MANUAL_PURCHASE/);
  assert.match(route, /supplierSnapshot: current\.supplierSnapshot/);
  assert.match(route, /expectedUnitCostCents: current\.expectedUnitCostCents/);
  assert.match(route, /expectedTotalCostCents: current\.expectedTotalCostCents/);
  assert.match(route, /orderItem: current\.orderItem/);
  assert.match(route, /PROCUREMENT_PURCHASE_RECONCILIATION_REQUIRED/);
});

test("fulfillment state writes occur only after purchase reconciliation succeeds", () => {
  const reconcile = route.indexOf("const purchaseReconciliation = reconcileManualPurchaseProjection");
  const failure = route.indexOf("if (!purchaseReconciliation.ok)");
  const transition = route.indexOf("const transition = transitionProcurement");
  const statusWrite = route.indexOf("data: { status: transition.next }");

  assert.ok(reconcile >= 0);
  assert.ok(failure > reconcile);
  assert.ok(transition > failure);
  assert.ok(statusWrite > transition);
});

test("shipment and delivery journals bind to reconciled purchase evidence without expanding authority", () => {
  assert.ok((route.match(/purchaseEvidenceHash:/g) || []).length >= 2);
  assert.match(route, /automaticSupplierPurchasingEnabled: false/);
  assert.doesNotMatch(route, /\bfetch\s*\(/);
  assert.doesNotMatch(route, /executionMode:\s*["']automated/);
  assert.doesNotMatch(route, /stripe/i);
});
