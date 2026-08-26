import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  deriveManualPurchaseExecutionEvidence,
  manualPurchaseExecutionEventKey,
  manualPurchaseEvidenceMatches,
  parseManualPurchaseExecutionEvidence,
} from "../src/lib/procurement-purchase-evidence";

const routePath = new URL("../src/app/api/admin/procurement/[id]/route.ts", import.meta.url);

const sourceLock = {
  version: 1 as const,
  sourceLockKey: `proc_source_lock_v1_${"a".repeat(64)}`,
  persistedSupplierId: "supplier_1",
  persistedOfferId: "offer_1",
  persistedOfferKey: "offer:key:1",
  supplierName: "Supplier One",
  sourceClass: "authorized_retailer",
  sourceUrl: "https://example.com/item",
  currency: "usd",
  expectedUnitCostCents: 1500,
};

function evidence(overrides: Partial<Parameters<typeof deriveManualPurchaseExecutionEvidence>[0]> = {}) {
  return deriveManualPurchaseExecutionEvidence({
    sourceLock,
    supplierOrderReference: "ORDER-123",
    quantity: 2,
    currency: "usd",
    actualTotalCostCents: 3000,
    expectedTotalCostCents: 3000,
    lineRevenueCents: 4400,
    ...overrides,
  });
}

test("manual purchase evidence is deterministic and supplier-reference scoped", () => {
  const first = evidence();
  const second = evidence();
  assert.ok(first);
  assert.deepEqual(first, second);
  assert.match(first.supplierOrderKey, /^proc_supplier_order_v1_[a-f0-9]{64}$/);
  assert.match(first.purchaseEvidenceHash, /^proc_purchase_evidence_v1_[a-f0-9]{64}$/);
  assert.equal(manualPurchaseExecutionEventKey(first), `procurement-manual-purchase:${first.supplierOrderKey}`);
});

test("same supplier order reference cannot silently change completion economics", () => {
  const first = evidence();
  const changedAmount = evidence({ actualTotalCostCents: 3100 });
  assert.ok(first && changedAmount);
  assert.equal(first.supplierOrderKey, changedAmount.supplierOrderKey);
  assert.notEqual(first.purchaseEvidenceHash, changedAmount.purchaseEvidenceHash);
  assert.equal(manualPurchaseEvidenceMatches(first, changedAmount), false);
});

test("execution evidence parser fails closed", () => {
  const current = evidence();
  assert.ok(current);
  assert.deepEqual(parseManualPurchaseExecutionEvidence(current), current);
  assert.equal(parseManualPurchaseExecutionEvidence({ ...current, actualTotalCostCents: 0 }), null);
  assert.equal(parseManualPurchaseExecutionEvidence({ ...current, sourceLockKey: "bad" }), null);
});

test("manual purchase route creates deterministic immutable execution event inside transaction", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /deriveManualPurchaseExecutionEvidence/);
  assert.match(source, /manualPurchaseExecutionEventKey\(executionEvidence\)/);
  assert.match(source, /executionEvidence,/);
  assert.match(source, /PROCUREMENT_SUPPLIER_ORDER_REFERENCE_CONFLICT/);
  assert.match(source, /updateMany\([\s\S]*eventKey:[\s\S]*manualPurchaseExecutionEventKey/);
  assert.doesNotMatch(source, /automaticSupplierPurchasingEnabled:\s*true/);
});
