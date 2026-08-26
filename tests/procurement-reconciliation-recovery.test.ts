import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { deriveProcurementSourceLock } from "../src/lib/procurement-source-lock";
import {
  deriveManualPurchaseExecutionEvidence,
  manualPurchaseExecutionEventKey,
} from "../src/lib/procurement-purchase-evidence";
import { PURCHASE_RECONCILIATION_BLOCKED_REASON } from "../src/lib/procurement-purchase-reconciliation";
import {
  PURCHASE_RECONCILIATION_RESOLUTION_EVENT,
  PURCHASE_RECONCILIATION_RESOLUTION_TOKEN_PREFIX,
  projectPurchaseReconciliationRecovery,
  purchaseReconciliationResolutionEventKey,
} from "../src/lib/procurement-reconciliation-recovery";

const routePath = new URL(
  "../src/app/api/admin/procurement/[id]/purchase-integrity/route.ts",
  import.meta.url,
);

function supplierSnapshot() {
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
  });
}

function blockedHealthyInput() {
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
    id: "intent_123",
    blockedReason: PURCHASE_RECONCILIATION_BLOCKED_REASON,
    updatedAt: new Date("2026-08-26T10:00:00.000Z"),
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
    purchaseEvents: [
      {
        eventKey: manualPurchaseExecutionEventKey(evidence),
        detail: JSON.stringify({ executionEvidence: evidence }),
      },
    ],
    auditEvents: [
      {
        type: "PURCHASE_RECONCILIATION_FAILED",
        detail: JSON.stringify({ reasons: ["actual_total_cost_mismatch"] }),
        createdAt: new Date("2026-08-26T09:30:00.000Z"),
      },
    ],
  };
}

test("reconciliation blocker can resolve only after current projection exactly matches immutable evidence", () => {
  const projected = projectPurchaseReconciliationRecovery(blockedHealthyInput());
  assert.equal(projected.blockerActive, true);
  assert.equal(projected.reconciliation.ok, true);
  assert.equal(projected.canResolve, true);
  assert.match(
    projected.resolutionToken || "",
    new RegExp(`^${PURCHASE_RECONCILIATION_RESOLUTION_TOKEN_PREFIX}[a-f0-9]{64}$`),
  );
  assert.equal(projected.immutableExecutionEvidence?.purchaseEvidenceHash.startsWith("proc_purchase_evidence_v1_"), true);
  assert.deepEqual(projected.latestFailure?.reasons, ["actual_total_cost_mismatch"]);
});

test("unresolved evidence drift never receives a resolution token", () => {
  const projected = projectPurchaseReconciliationRecovery({
    ...blockedHealthyInput(),
    actualTotalCostCents: 5300,
  });
  assert.equal(projected.reconciliation.ok, false);
  assert.ok(projected.reconciliation.reasons.includes("actual_total_cost_mismatch"));
  assert.equal(projected.canResolve, false);
  assert.equal(projected.resolutionToken, null);
});

test("unrelated blockers cannot be cleared through purchase reconciliation recovery", () => {
  const projected = projectPurchaseReconciliationRecovery({
    ...blockedHealthyInput(),
    blockedReason: "ORDER_SOURCE_SNAPSHOT_MISSING_OR_INVALID",
  });
  assert.equal(projected.reconciliation.ok, true);
  assert.equal(projected.blockerActive, false);
  assert.equal(projected.canResolve, false);
  assert.equal(projected.resolutionToken, null);
});

test("resolution token is optimistic and changes whenever authoritative projection changes", () => {
  const first = projectPurchaseReconciliationRecovery(blockedHealthyInput());
  const second = projectPurchaseReconciliationRecovery({
    ...blockedHealthyInput(),
    updatedAt: new Date("2026-08-26T10:00:01.000Z"),
  });
  assert.ok(first.resolutionToken);
  assert.ok(second.resolutionToken);
  assert.notEqual(first.resolutionToken, second.resolutionToken);
  assert.notEqual(
    purchaseReconciliationResolutionEventKey("intent_123", first.resolutionToken),
    purchaseReconciliationResolutionEventKey("intent_123", second.resolutionToken),
  );
});

test("owner recovery route is confirmation-bound, transactional, audit-only, and preserves fulfillment history", async () => {
  const route = await readFile(routePath, "utf8");

  assert.equal(PURCHASE_RECONCILIATION_RESOLUTION_EVENT, "PURCHASE_RECONCILIATION_RESOLVED");
  assert.match(route, /requireProcurementOwner/);
  assert.match(route, /isSameOriginProcurementMutation/);
  assert.match(route, /acknowledgedEvidenceMatch: z\.literal\(true\)/);
  assert.match(route, /FOR UPDATE/);
  assert.match(route, /PROCUREMENT_RECONCILIATION_STILL_FAILED/);
  assert.match(route, /PROCUREMENT_RECONCILIATION_RESOLUTION_TOKEN_STALE/);
  assert.match(route, /data: \{ blockedReason: null \}/);
  assert.match(route, /type: PURCHASE_RECONCILIATION_RESOLUTION_EVENT/);
  assert.doesNotMatch(route, /data:\s*\{[^}]*status:/s);
  assert.doesNotMatch(route, /data:\s*\{[^}]*supplierOrderReference:/s);
  assert.doesNotMatch(route, /automaticSupplierPurchasingEnabled:\s*true/);
  assert.doesNotMatch(route, /placeOrder|createStripe|paymentIntent|reserveInventory/);
});
