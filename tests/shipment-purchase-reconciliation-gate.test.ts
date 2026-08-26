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
  const failure = route.indexOf("if (!purchaseReconciliation.ok || !purchaseReconciliation.evidence?.purchaseEvidenceHash)");
  const transition = route.indexOf("const transition = transitionProcurement");
  const statusWrite = route.indexOf("data: { status: nextStatus }");

  assert.ok(reconcile >= 0);
  assert.ok(failure > reconcile);
  assert.ok(transition > failure);
  assert.ok(statusWrite > transition);
});

test("every shipment and delivery journal remains bound to reconciled purchase evidence", () => {
  assert.ok((route.match(/purchaseEvidenceHash/g) || []).length >= 6);
  assert.match(route, /reconcileShipmentJournal/);
  assert.match(route, /allowPartial: true/);
  assert.match(route, /shipmentEventKey: targetShipmentEvent\.eventKey/);
  assert.match(route, /procurementEventKey\(current\.id, parsed\.data\.action, shipment\.packageId\)/);
  assert.match(route, /procurementEventKey\(current\.id, parsed\.data\.action, targetPackage\.packageId\)/);
});

test("multi-package fulfillment does not expand procurement or network authority", () => {
  assert.match(route, /automaticSupplierPurchasingEnabled: false/);
  assert.match(route, /executionMode !== "manual_only"/);
  assert.doesNotMatch(route, /\bfetch\s*\(/);
  assert.doesNotMatch(route, /executionMode:\s*["']automated/);
  assert.doesNotMatch(route, /stripe/i);
});
