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

function makeShipment(trackingNumber: string, quantity: number) {
  const shipment = createShipmentRecord({
    carrierCode: "ups",
    trackingNumber,
    quantity,
    shippedAt: "2026-08-24T20:00:00.000Z",
  });
  assert.ok(shipment);
  return shipment;
}

function shipmentEvent(shipment: ReturnType<typeof makeShipment>, overrides: Record<string, unknown> = {}) {
  return {
    eventKey: `procurement:test:shipment:${shipment.packageId}`,
    detail: JSON.stringify({
      shipment,
      purchaseEvidenceHash,
      ...overrides,
    }),
  };
}

test("shipment journal reconciliation accepts one exact purchase-bound shipment", () => {
  const shipment = makeShipment("1Z999AA10123456784", 2);
  const result = reconcileShipmentJournal({
    events: [shipmentEvent(shipment)],
    expectedPurchaseEvidenceHash: purchaseEvidenceHash,
    expectedQuantity: 2,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(result.shipment, shipment);
  assert.deepEqual(result.shipments, [shipment]);
  assert.equal(result.shippedQuantity, 2);
  assert.equal(result.purchaseEvidenceHash, purchaseEvidenceHash);
});

test("shipment journal reconciliation accepts multiple distinct packages totaling ordered quantity", () => {
  const first = makeShipment("1Z999AA10123456784", 1);
  const second = makeShipment("1Z999AA10123456785", 1);
  const result = reconcileShipmentJournal({
    events: [shipmentEvent(first), shipmentEvent(second)],
    expectedPurchaseEvidenceHash: purchaseEvidenceHash,
    expectedQuantity: 2,
  });
  assert.equal(result.ok, true);
  assert.equal(result.shipments.length, 2);
  assert.equal(result.shipment, null);
  assert.equal(result.shippedQuantity, 2);
});

test("shipment journal reconciliation permits bounded partial package sets only when explicitly requested", () => {
  const first = makeShipment("1Z999AA10123456784", 1);
  const strict = reconcileShipmentJournal({
    events: [shipmentEvent(first)],
    expectedPurchaseEvidenceHash: purchaseEvidenceHash,
    expectedQuantity: 2,
  });
  assert.equal(strict.ok, false);
  assert.ok(strict.reasons.includes("shipment_quantity_mismatch"));

  const partial = reconcileShipmentJournal({
    events: [shipmentEvent(first)],
    expectedPurchaseEvidenceHash: purchaseEvidenceHash,
    expectedQuantity: 2,
    allowPartial: true,
  });
  assert.equal(partial.ok, true);
  assert.equal(partial.shippedQuantity, 1);
});

test("shipment journal reconciliation rejects duplicate package identity and over-shipment", () => {
  const first = makeShipment("1Z999AA10123456784", 1);
  const duplicate = reconcileShipmentJournal({
    events: [shipmentEvent(first), { ...shipmentEvent(first), eventKey: "duplicate-key" }],
    expectedPurchaseEvidenceHash: purchaseEvidenceHash,
    expectedQuantity: 2,
    allowPartial: true,
  });
  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.reasons.includes("shipment_package_duplicate"));

  const second = makeShipment("1Z999AA10123456785", 2);
  const exceeded = reconcileShipmentJournal({
    events: [shipmentEvent(first), shipmentEvent(second)],
    expectedPurchaseEvidenceHash: purchaseEvidenceHash,
    expectedQuantity: 2,
    allowPartial: true,
  });
  assert.equal(exceeded.ok, false);
  assert.ok(exceeded.reasons.includes("shipment_quantity_exceeded"));
});

test("shipment journal reconciliation rejects purchase-evidence drift on any package", () => {
  const first = makeShipment("1Z999AA10123456784", 1);
  const second = makeShipment("1Z999AA10123456785", 1);
  const result = reconcileShipmentJournal({
    events: [
      shipmentEvent(first),
      shipmentEvent(second, { purchaseEvidenceHash: "b".repeat(64) }),
    ],
    expectedPurchaseEvidenceHash: purchaseEvidenceHash,
    expectedQuantity: 2,
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("shipment_purchase_evidence_mismatch"));
});

test("shipment journal reconciliation rejects missing purchase evidence", () => {
  const shipment = makeShipment("1Z999AA10123456784", 2);
  const result = reconcileShipmentJournal({
    events: [{ eventKey: "shipment", detail: JSON.stringify({ shipment }) }],
    expectedPurchaseEvidenceHash: purchaseEvidenceHash,
    expectedQuantity: 2,
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("shipment_purchase_evidence_missing"));
});

test("delivery route reconciles prior shipment packages before state mutation", () => {
  assert.match(route, /reconcileShipmentJournal/);
  assert.match(route, /SHIPMENT_JOURNAL_RECONCILIATION_REQUIRED/);
  assert.match(route, /expectedPurchaseEvidenceHash: purchaseEvidenceHash/);
  assert.match(route, /expectedQuantity: current\.quantity/);
  assert.match(route, /allowPartial: true/);
  assert.match(route, /shipmentEventKey:/);
  assert.match(route, /packageId/);

  const reconciliation = route.indexOf("const shipmentReconciliation = reconcileShipmentJournal");
  const statusWrite = route.lastIndexOf("data: { status: nextStatus }");
  assert.ok(reconciliation >= 0);
  assert.ok(statusWrite > reconciliation);
});

test("fulfillment journal hardening does not expand procurement or network authority", () => {
  assert.match(route, /executionMode !== "manual_only"/);
  assert.match(route, /automaticSupplierPurchasingEnabled: false/);
  assert.doesNotMatch(route, /\bfetch\s*\(/);
  assert.doesNotMatch(route, /executionMode:\s*["']automated/);
});
