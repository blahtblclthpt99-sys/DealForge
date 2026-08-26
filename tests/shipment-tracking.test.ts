import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { transitionProcurement } from "../src/lib/procurement-state-machine";
import {
  buildOfficialTrackingUrl,
  createShipmentRecord,
  normalizeTrackingNumber,
  parseDeliveryEventDetail,
  parseShipmentEventDetail,
  projectPublicShipment,
  publicFulfillmentStatus,
} from "../src/lib/shipment-tracking";

const root = process.cwd();
const adminShipmentRoute = readFileSync(
  join(root, "src/app/api/admin/procurement/[id]/shipment/route.ts"),
  "utf8",
);
const customerOrdersRoute = readFileSync(join(root, "src/app/api/account/orders/route.ts"), "utf8");

test("procurement cannot ship before a manual supplier order is recorded", () => {
  assert.deepEqual(transitionProcurement("approved_manual", "RECORD_SHIPMENT"), {
    ok: false,
    reason: "INVALID_TRANSITION",
  });
  assert.deepEqual(transitionProcurement("supplier_ordered_manual", "RECORD_SHIPMENT"), {
    ok: true,
    next: "shipped",
  });
  assert.deepEqual(transitionProcurement("shipped", "RECORD_SHIPMENT"), {
    ok: false,
    reason: "INVALID_TRANSITION",
  });
});

test("delivery requires a previously shipped procurement intent", () => {
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

test("shipment journal round-trips into a customer-safe projection", () => {
  const shipment = createShipmentRecord({
    carrierCode: "ups",
    trackingNumber: "1Z999AA10123456784",
    quantity: 2,
    shippedAt: "2026-08-24T20:00:00.000Z",
  });
  assert.ok(shipment);
  const shipmentDetail = JSON.stringify({ shipment });
  const deliveryDetail = JSON.stringify({
    delivery: { version: 1, deliveredAt: "2026-08-24T21:00:00.000Z" },
  });
  assert.deepEqual(parseShipmentEventDetail(shipmentDetail), shipment);
  assert.deepEqual(parseDeliveryEventDetail(deliveryDetail), {
    version: 1,
    deliveredAt: "2026-08-24T21:00:00.000Z",
  });
  assert.deepEqual(
    projectPublicShipment([
      { type: "MARK_DELIVERED", detail: deliveryDetail },
      { type: "RECORD_SHIPMENT", detail: shipmentDetail },
    ]),
    {
      status: "delivered",
      carrierName: "UPS",
      trackingNumber: "1Z999AA10123456784",
      trackingUrl: "https://www.ups.com/track?tracknum=1Z999AA10123456784",
      shippedAt: "2026-08-24T20:00:00.000Z",
      deliveredAt: "2026-08-24T21:00:00.000Z",
    },
  );
});

test("internal procurement states collapse to safe customer fulfillment states", () => {
  assert.equal(publicFulfillmentStatus("awaiting_review"), "processing");
  assert.equal(publicFulfillmentStatus("blocked_source_integrity"), "processing");
  assert.equal(publicFulfillmentStatus("supplier_ordered_manual"), "processing");
  assert.equal(publicFulfillmentStatus("shipped"), "shipped");
  assert.equal(publicFulfillmentStatus("delivered"), "delivered");
});

test("owner shipment route preserves owner-only, same-origin, manual-only, and financial boundaries", () => {
  assert.match(adminShipmentRoute, /requireProcurementOwner/);
  assert.match(adminShipmentRoute, /isSameOriginProcurementMutation\(request\)/);
  assert.match(adminShipmentRoute, /executionMode !== "manual_only"/);
  assert.match(adminShipmentRoute, /current\.order\.status !== "paid"/);
  assert.match(adminShipmentRoute, /supplierOrderReference/);
  assert.match(adminShipmentRoute, /actualTotalCostCents/);
  assert.match(adminShipmentRoute, /executedAt/);
  assert.match(adminShipmentRoute, /PROCUREMENT_CONCURRENT_CHANGE/);
  assert.doesNotMatch(adminShipmentRoute, /\bfetch\s*\(/);
});

test("shipment and delivery rerun exact manual-purchase reconciliation before fulfillment advances", () => {
  assert.match(adminShipmentRoute, /reconcileManualPurchaseProjection/);
  assert.match(adminShipmentRoute, /RECORD_MANUAL_PURCHASE/);
  assert.match(adminShipmentRoute, /orderItem: \{ select: \{ lineTotalCents: true \} \}/);
  assert.match(adminShipmentRoute, /PROCUREMENT_PURCHASE_RECONCILIATION_REQUIRED/);
  assert.match(adminShipmentRoute, /purchaseEvidenceHash/);

  const reconciliationIndex = adminShipmentRoute.indexOf("const purchaseReconciliation = reconcileManualPurchaseProjection");
  const transitionIndex = adminShipmentRoute.indexOf("const transition = transitionProcurement");
  const firstStatusWriteIndex = adminShipmentRoute.indexOf("data: { status: transition.next }");
  assert.ok(reconciliationIndex >= 0);
  assert.ok(transitionIndex > reconciliationIndex);
  assert.ok(firstStatusWriteIndex > transitionIndex);
});

test("customer orders rehydrate identity and do not expose supplier economics", () => {
  assert.match(customerOrdersRoute, /prisma\.user\.findUnique/);
  assert.match(customerOrdersRoute, /where: \{ userId: currentUser\.id \}/);
  assert.match(customerOrdersRoute, /projectPublicShipment/);
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
