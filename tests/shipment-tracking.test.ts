import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { transitionProcurement } from "../src/lib/procurement-state-machine";
import {
  buildOfficialTrackingUrl,
  createDeliveryRecord,
  createShipmentRecord,
  normalizeTrackingNumber,
  parseDeliveryEventDetail,
  parseShipmentEventDetail,
  projectPublicShipment,
  projectPublicShipments,
  publicFulfillmentStatus,
  shipmentPackageId,
  summarizeShipmentJournal,
} from "../src/lib/shipment-tracking";

const root = process.cwd();
const adminShipmentRoute = readFileSync(
  join(root, "src/app/api/admin/procurement/[id]/shipment/route.ts"),
  "utf8",
);
const customerOrdersRoute = readFileSync(join(root, "src/app/api/account/orders/route.ts"), "utf8");
const ownerFulfillmentConsole = readFileSync(
  join(root, "src/components/procurement-fulfillment-console.tsx"),
  "utf8",
);

test("procurement supports additional shipment journals only after manual supplier order", () => {
  assert.deepEqual(transitionProcurement("approved_manual", "RECORD_SHIPMENT"), {
    ok: false,
    reason: "INVALID_TRANSITION",
  });
  assert.deepEqual(transitionProcurement("supplier_ordered_manual", "RECORD_SHIPMENT"), {
    ok: true,
    next: "shipped",
  });
  assert.deepEqual(transitionProcurement("shipped", "RECORD_SHIPMENT"), {
    ok: true,
    next: "shipped",
  });
  assert.deepEqual(transitionProcurement("delivered", "RECORD_SHIPMENT"), {
    ok: false,
    reason: "INVALID_TRANSITION",
  });
});

test("delivery remains restricted to shipped procurement intents", () => {
  assert.deepEqual(transitionProcurement("supplier_ordered_manual", "MARK_DELIVERED"), {
    ok: false,
    reason: "INVALID_TRANSITION",
  });
  assert.deepEqual(transitionProcurement("shipped", "MARK_DELIVERED"), {
    ok: true,
    next: "delivered",
  });
  assert.deepEqual(transitionProcurement("delivered", "MARK_DELIVERED"), {
    ok: false,
    reason: "INVALID_TRANSITION",
  });
});

test("tracking numbers are normalized and unsafe forms are rejected", () => {
  assert.equal(normalizeTrackingNumber(" 1Z 999 AA1 01 2345 6784 "), "1Z999AA10123456784");
  assert.equal(normalizeTrackingNumber("javascript:alert(1)"), null);
  assert.equal(normalizeTrackingNumber("abc/../../secret"), null);
  assert.equal(normalizeTrackingNumber("a\nb\rc"), null);
});

test("known carriers only produce official tracking hosts", () => {
  assert.match(buildOfficialTrackingUrl("ups", "1Z999AA10123456784") || "", /^https:\/\/www\.ups\.com\//);
  assert.match(buildOfficialTrackingUrl("usps", "9400111899223856928499") || "", /^https:\/\/tools\.usps\.com\//);
  assert.match(buildOfficialTrackingUrl("fedex", "123456789012") || "", /^https:\/\/www\.fedex\.com\//);
  assert.match(buildOfficialTrackingUrl("dhl", "1234567890") || "", /^https:\/\/www\.dhl\.com\//);
  assert.equal(buildOfficialTrackingUrl("other", "ABC123"), null);
});

test("new shipment records carry deterministic package identity", () => {
  const shipment = createShipmentRecord({
    carrierCode: "ups",
    trackingNumber: "1Z999AA10123456784",
    quantity: 2,
    shippedAt: "2026-08-24T20:00:00.000Z",
  });
  assert.ok(shipment);
  assert.equal(shipment.version, 2);
  assert.equal(shipment.packageId, shipmentPackageId("ups", "1Z999AA10123456784"));
  assert.deepEqual(parseShipmentEventDetail(JSON.stringify({ shipment })), shipment);
});

test("legacy v1 shipment and delivery journals remain readable and order-insensitive", () => {
  const trackingNumber = "1Z999AA10123456784";
  const legacyShipment = {
    version: 1,
    carrierCode: "ups",
    carrierName: "UPS",
    trackingNumber,
    trackingUrl: buildOfficialTrackingUrl("ups", trackingNumber),
    quantity: 2,
    shippedAt: "2026-08-24T20:00:00.000Z",
  } as const;
  const legacyDelivery = { version: 1, deliveredAt: "2026-08-24T21:00:00.000Z" } as const;
  assert.deepEqual(parseShipmentEventDetail(JSON.stringify({ shipment: legacyShipment })), legacyShipment);
  assert.deepEqual(parseDeliveryEventDetail(JSON.stringify({ delivery: legacyDelivery })), legacyDelivery);
  assert.equal(
    projectPublicShipment([
      { type: "MARK_DELIVERED", detail: JSON.stringify({ delivery: legacyDelivery }) },
      { type: "RECORD_SHIPMENT", detail: JSON.stringify({ shipment: legacyShipment }) },
    ], 2)?.status,
    "delivered",
  );
});

test("multi-package journal preserves package delivery and cumulative quantities", () => {
  const first = createShipmentRecord({
    carrierCode: "ups",
    trackingNumber: "1Z999AA10123456784",
    quantity: 1,
    shippedAt: "2026-08-24T20:00:00.000Z",
  });
  const second = createShipmentRecord({
    carrierCode: "fedex",
    trackingNumber: "123456789012",
    quantity: 2,
    shippedAt: "2026-08-24T20:30:00.000Z",
  });
  assert.ok(first);
  assert.ok(second);
  const deliveredFirst = createDeliveryRecord({
    packageId: first.packageId,
    deliveredAt: "2026-08-25T20:00:00.000Z",
  });
  assert.ok(deliveredFirst);
  const events = [
    { type: "RECORD_SHIPMENT", detail: JSON.stringify({ shipment: first }) },
    { type: "RECORD_SHIPMENT", detail: JSON.stringify({ shipment: second }) },
    { type: "MARK_DELIVERED", detail: JSON.stringify({ delivery: deliveredFirst }) },
  ];
  const summary = summarizeShipmentJournal(events);
  assert.equal(summary.ok, true);
  if (!summary.ok) return;
  assert.equal(summary.shippedQuantity, 3);
  assert.equal(summary.deliveredQuantity, 1);
  assert.equal(summary.packages.length, 2);
  assert.equal(summary.packages[0].status, "delivered");
  assert.equal(summary.packages[1].status, "shipped");
  assert.equal(projectPublicShipments(events, 3).length, 2);
  assert.equal(projectPublicShipment(events, 3), null);
});

test("shipment journal fails closed on duplicate package or unknown delivery", () => {
  const shipment = createShipmentRecord({
    carrierCode: "ups",
    trackingNumber: "1Z999AA10123456784",
    quantity: 1,
    shippedAt: "2026-08-24T20:00:00.000Z",
  });
  assert.ok(shipment);
  assert.deepEqual(
    summarizeShipmentJournal([
      { type: "RECORD_SHIPMENT", detail: JSON.stringify({ shipment }) },
      { type: "RECORD_SHIPMENT", detail: JSON.stringify({ shipment }) },
    ]),
    { ok: false, reason: "SHIPMENT_PACKAGE_DUPLICATE" },
  );
  const unknownDelivery = createDeliveryRecord({
    packageId: "pkg_000000000000000000000000",
    deliveredAt: "2026-08-25T20:00:00.000Z",
  });
  assert.ok(unknownDelivery);
  assert.deepEqual(
    summarizeShipmentJournal([
      { type: "RECORD_SHIPMENT", detail: JSON.stringify({ shipment }) },
      { type: "MARK_DELIVERED", detail: JSON.stringify({ delivery: unknownDelivery }) },
    ]),
    { ok: false, reason: "DELIVERY_PACKAGE_UNKNOWN" },
  );
});

test("internal procurement states collapse to safe customer fulfillment states", () => {
  assert.equal(publicFulfillmentStatus("awaiting_review"), "processing");
  assert.equal(publicFulfillmentStatus("blocked_source_integrity"), "processing");
  assert.equal(publicFulfillmentStatus("supplier_ordered_manual"), "processing");
  assert.equal(publicFulfillmentStatus("shipped"), "shipped");
  assert.equal(publicFulfillmentStatus("delivered"), "delivered");
});

test("owner shipment route preserves purchase reconciliation and multi-package boundaries", () => {
  assert.match(adminShipmentRoute, /requireProcurementOwner/);
  assert.match(adminShipmentRoute, /isSameOriginProcurementMutation\(request\)/);
  assert.match(adminShipmentRoute, /executionMode !== "manual_only"/);
  assert.match(adminShipmentRoute, /current\.order\.status !== "paid"/);
  assert.match(adminShipmentRoute, /reconcileManualPurchaseProjection/);
  assert.match(adminShipmentRoute, /purchaseEvidenceHash/);
  assert.match(adminShipmentRoute, /current\.quantity - fulfillmentJournal\.shippedQuantity/);
  assert.match(adminShipmentRoute, /SHIPMENT_QUANTITY_EXCEEDS_REMAINING/);
  assert.match(adminShipmentRoute, /shipment\.packageId/);
  assert.match(adminShipmentRoute, /fullyShipped && everyRecordedPackageDelivered/);
  assert.match(adminShipmentRoute, /PROCUREMENT_CONCURRENT_CHANGE/);
  assert.doesNotMatch(adminShipmentRoute, /\bfetch\s*\(/);
});

test("fulfillment state writes occur after exact purchase reconciliation", () => {
  const reconciliationIndex = adminShipmentRoute.indexOf("const purchaseReconciliation = reconcileManualPurchaseProjection");
  const transitionIndex = adminShipmentRoute.indexOf("const transition = transitionProcurement");
  const firstStatusWriteIndex = adminShipmentRoute.indexOf("data: { status: nextStatus }");
  assert.ok(reconciliationIndex >= 0);
  assert.ok(transitionIndex > reconciliationIndex);
  assert.ok(firstStatusWriteIndex > transitionIndex);
});

test("owner fulfillment console cannot place supplier orders or expand payment authority", () => {
  assert.match(ownerFulfillmentConsole, /RECORD_SHIPMENT/);
  assert.match(ownerFulfillmentConsole, /MARK_DELIVERED/);
  assert.match(ownerFulfillmentConsole, /executionMode === "manual_only"/);
  assert.doesNotMatch(ownerFulfillmentConsole, /RECORD_MANUAL_PURCHASE/);
  assert.doesNotMatch(ownerFulfillmentConsole, /supplierSnapshot/);
  assert.doesNotMatch(ownerFulfillmentConsole, /stripe|paymentIntent|checkoutSession/i);
});

test("customer orders expose safe package tracking without supplier economics", () => {
  assert.match(customerOrdersRoute, /prisma\.user\.findUnique/);
  assert.match(customerOrdersRoute, /where: \{ userId: currentUser\.id \}/);
  assert.match(customerOrdersRoute, /projectPublicShipment/);
  assert.match(customerOrdersRoute, /projectPublicShipments/);
  assert.match(customerOrdersRoute, /shipments:/);
  for (const forbidden of [
    "supplierSnapshot",
    "supplierOrderReference",
    "actualTotalCostCents",
    "expectedTotalCostCents",
    "blockedReason",
    "approvedByUserId",
  ]) {
    assert.equal(customerOrdersRoute.includes(forbidden), false, `customer route leaked ${forbidden}`);
  }
});
