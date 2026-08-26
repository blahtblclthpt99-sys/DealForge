import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reconcileShipmentJournal } from "../src/lib/shipment-journal-integrity";
import { createShipmentRecord } from "../src/lib/shipment-tracking";

const root = process.cwd();
const route = readFileSync(
  join(root, "src/app/api/admin/procurement/[id]/shipment/route.ts"),
  "utf8",
);

const purchaseEvidenceHash = "a".repeat(64);
const shipment = createShipmentRecord({
  carrierCode: "ups",
  trackingNumber: "1Z999AA10123456784",
  quantity: 2,
  shippedAt: "2026-08-24T20:00:00.000Z",
});
assert.ok(shipment);

function shipmentEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventKey: "procurement:test:shipment:1",
    detail: JSON.stringify({
      shipment,
      purchaseEvidenceHash,
      ...overrides,
    }),
  };
}

test("shipment journal reconciliation accepts one exact purchase-bound shipment", () => {
  const result = reconcileShipmentJournal({
    events: [shipmentEvent()],
    expectedPurchaseEvidenceHash: purchaseEvidenceHash,
    expectedQuantity: 2,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(result.shipment, shipment);
  assert.equal(result.purchaseEvidenceHash, purchaseEvidenceHash);
});

test("shipment journal reconciliation fails closed on duplicate shipment events", () => {
  const result = reconcileShipmentJournal({
    events: [shipmentEvent(), { ...shipmentEvent(), eventKey: "procurement:test:shipment:2" }],
    expectedPurchaseEvidenceHash: purchaseEvidenceHash,
    expectedQuantity: 2,
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("shipment_event_duplicate"));
});

test("shipment journal reconciliation rejects purchase-evidence drift", () => {
  const result = reconcileShipmentJournal({
    events: [shipmentEvent({ purchaseEvidenceHash: "b".repeat(64) })],
    expectedPurchaseEvidenceHash: purchaseEvidenceHash,
    expectedQuantity: 2,
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("shipment_purchase_evidence_mismatch"));
});

test("shipment journal reconciliation rejects quantity drift and missing evidence", () => {
  const differentShipment = createShipmentRecord({
    carrierCode: "ups",
    trackingNumber: "1Z999AA10123456784",
    quantity: 1,
    shippedAt: "2026-08-24T20:00:00.000Z",
  });
  assert.ok(differentShipment);
  const result = reconcileShipmentJournal({
    events: [
      {
        eventKey: "procurement:test:shipment:1",
        detail: JSON.stringify({ shipment: differentShipment }),
      },
    ],
    expectedPurchaseEvidenceHash: purchaseEvidenceHash,
    expectedQuantity: 2,
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("shipment_quantity_mismatch"));
  assert.ok(result.reasons.includes("shipment_purchase_evidence_missing"));
});

test("delivery route reconciles the shipment journal before state mutation", () => {
  assert.match(route, /reconcileShipmentJournal/);
  assert.match(route, /SHIPMENT_JOURNAL_RECONCILIATION_REQUIRED/);
  assert.match(route, /expectedPurchaseEvidenceHash: purchaseEvidenceHash/);
  assert.match(route, /expectedQuantity: current\.quantity/);
  assert.match(route, /shipmentEventKey:/);

  const reconciliation = route.indexOf("const shipmentReconciliation = reconcileShipmentJournal");
  const deliveryTimestamp = route.indexOf("const deliveredAt = normalizeTimestamp");
  const statusWrite = route.lastIndexOf("data: { status: transition.next }");
  assert.ok(reconciliation >= 0);
  assert.ok(deliveryTimestamp > reconciliation);
  assert.ok(statusWrite > deliveryTimestamp);
});

test("fulfillment journal hardening does not expand procurement or network authority", () => {
  assert.match(route, /executionMode !== "manual_only"/);
  assert.match(route, /automaticSupplierPurchasingEnabled: false/);
  assert.doesNotMatch(route, /\bfetch\s*\(/);
  assert.doesNotMatch(route, /executionMode:\s*["']automated/);
});
