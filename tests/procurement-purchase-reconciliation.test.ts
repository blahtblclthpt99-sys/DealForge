import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  reconcileManualPurchaseProjection,
  PURCHASE_RECONCILIATION_BLOCKED_REASON,
} from "../src/lib/procurement-purchase-reconciliation";
import { deriveProcurementSourceLock } from "../src/lib/procurement-source-lock";
import {
  deriveManualPurchaseExecutionEvidence,
  manualPurchaseExecutionEventKey,
} from "../src/lib/procurement-purchase-evidence";

const monitorPath = new URL("../src/lib/procurement-purchase-reconciliation.ts", import.meta.url);
const maintenanceRoutePath = new URL("../src/app/api/internal/commerce-monitor/route.ts", import.meta.url);

function supplierSnapshot(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    persistedSupplierId: "supplier_123",
    persistedOfferId: "offer_123",
    persistedOfferKey: "offer_key_123",
    supplierName: "Authorized Supplier",
    sourceClass: "authorized_dropshipper",
    sourceUrl: "https://supplier.example/item",
    sourceVerifiedAt: "2026-08-26T05:00:00.000Z",
    priceVerifiedAt: "2026-08-26T05:01:00.000Z",
    inventoryConfidenceBps: 9500,
    availability: "in_stock",
    currency: "usd",
    costBreakdown: {
      itemCostCents: 2500,
      shippingCents: 100,
      taxCents: 0,
      supplierFeeCents: 0,
      handlingCents: 0,
      landedCostCents: 2600,
    },
    ...overrides,
  });
}

function healthyProjection() {
  const snapshot = supplierSnapshot();
  const sourceLock = deriveProcurementSourceLock(snapshot, 2600, "usd");
  assert.ok(sourceLock);
  const evidence = deriveManualPurchaseExecutionEvidence({
    sourceLock,
    supplierOrderReference: "ORDER-123",
    quantity: 2,
    currency: "usd",
    actualTotalCostCents: 5200,
    expectedTotalCostCents: 5200,
    lineRevenueCents: 7000,
  });
  assert.ok(evidence);
  return {
    status: "supplier_ordered_manual",
    supplierSnapshot: snapshot,
    quantity: 2,
    expectedUnitCostCents: 2600,
    expectedTotalCostCents: 5200,
    currency: "usd",
    supplierOrderReference: "ORDER-123",
    actualTotalCostCents: 5200,
    executedAt: new Date("2026-08-26T09:00:00.000Z"),
    orderItem: { lineTotalCents: 7000 },
    events: [
      {
        eventKey: manualPurchaseExecutionEventKey(evidence),
        detail: JSON.stringify({ executionEvidence: evidence }),
      },
    ],
  };
}

test("completed manual purchase reconciles exactly to immutable execution evidence", () => {
  const result = reconcileManualPurchaseProjection(healthyProjection());
  assert.equal(result.ok, true);
  assert.deepEqual(result.reasons, []);
  assert.ok(result.evidence);
});

test("projection drift in supplier reference, amount, quantity, or status fails closed", () => {
  const supplierReference = reconcileManualPurchaseProjection({
    ...healthyProjection(),
    supplierOrderReference: "ORDER-CHANGED",
  });
  assert.equal(supplierReference.ok, false);
  assert.ok(supplierReference.reasons.includes("supplier_order_reference_mismatch"));
  assert.ok(supplierReference.reasons.includes("purchase_evidence_hash_mismatch"));

  const amount = reconcileManualPurchaseProjection({ ...healthyProjection(), actualTotalCostCents: 5300 });
  assert.ok(amount.reasons.includes("actual_total_cost_mismatch"));

  const quantity = reconcileManualPurchaseProjection({ ...healthyProjection(), quantity: 3 });
  assert.ok(quantity.reasons.includes("quantity_mismatch"));

  const status = reconcileManualPurchaseProjection({ ...healthyProjection(), status: "awaiting_review" });
  assert.ok(status.reasons.includes("purchase_status_mismatch"));
});

test("missing, duplicate, malformed, and wrong-key completion events fail closed", () => {
  const missing = reconcileManualPurchaseProjection({ ...healthyProjection(), events: [] });
  assert.deepEqual(missing.reasons, ["purchase_completion_event_missing"]);

  const base = healthyProjection();
  const duplicate = reconcileManualPurchaseProjection({ ...base, events: [...base.events, ...base.events] });
  assert.ok(duplicate.reasons.includes("purchase_completion_event_duplicate"));

  const malformed = reconcileManualPurchaseProjection({
    ...healthyProjection(),
    events: [{ eventKey: "bad", detail: "{}" }],
  });
  assert.ok(malformed.reasons.includes("purchase_completion_event_invalid"));

  const wrongKeyBase = healthyProjection();
  const wrongKey = reconcileManualPurchaseProjection({
    ...wrongKeyBase,
    events: [{ ...wrongKeyBase.events[0], eventKey: "procurement-manual-purchase:wrong" }],
  });
  assert.ok(wrongKey.reasons.includes("purchase_completion_event_key_mismatch"));
});

test("source-lock drift and missing execution timestamp are quarantinable mismatches", () => {
  const changedSnapshot = supplierSnapshot({
    persistedSupplierId: "supplier_other",
    persistedOfferId: "offer_other",
    persistedOfferKey: "offer_key_other",
  });
  const sourceDrift = reconcileManualPurchaseProjection({
    ...healthyProjection(),
    supplierSnapshot: changedSnapshot,
  });
  assert.ok(sourceDrift.reasons.includes("source_lock_mismatch"));
  assert.ok(sourceDrift.reasons.includes("supplier_identity_mismatch"));
  assert.ok(sourceDrift.reasons.includes("supplier_offer_mismatch"));

  const missingTimestamp = reconcileManualPurchaseProjection({ ...healthyProjection(), executedAt: null });
  assert.ok(missingTimestamp.reasons.includes("execution_timestamp_missing"));
});

test("reconciliation monitor is one-way and maintenance invokes it", async () => {
  const monitor = await readFile(monitorPath, "utf8");
  const route = await readFile(maintenanceRoutePath, "utf8");

  assert.equal(PURCHASE_RECONCILIATION_BLOCKED_REASON, "manual_purchase_reconciliation_failed");
  assert.match(monitor, /type: "PURCHASE_RECONCILIATION_FAILED"/);
  assert.match(monitor, /data: \{ blockedReason: PURCHASE_RECONCILIATION_BLOCKED_REASON \}/);
  assert.doesNotMatch(monitor, /data:\s*\{\s*blockedReason:\s*null/);
  assert.doesNotMatch(monitor, /automaticSupplierPurchasingEnabled:\s*true/);
  assert.match(route, /sweepManualPurchaseReconciliation\("cloudflare-cron", 250\)/);
  assert.match(route, /procurementReconciliation/);
});
