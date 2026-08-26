import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createDeliveryRecord,
  createShipmentRecord,
  projectPublicShipment,
  projectPublicShipments,
} from "../src/lib/shipment-tracking";

const root = process.cwd();
const accountOrdersRoute = readFileSync(join(root, "src/app/api/account/orders/route.ts"), "utf8");

const shipment = createShipmentRecord({
  carrierCode: "ups",
  trackingNumber: "1Z999AA10123456784",
  quantity: 1,
  shippedAt: "2026-08-24T20:00:00.000Z",
});
assert.ok(shipment);

const shipmentEvent = {
  type: "RECORD_SHIPMENT",
  detail: JSON.stringify({ shipment }),
};

const delivery = createDeliveryRecord({
  packageId: shipment.packageId,
  deliveredAt: "2026-08-24T21:00:00.000Z",
});
assert.ok(delivery);
const deliveryEvent = {
  type: "MARK_DELIVERED",
  detail: JSON.stringify({ delivery }),
};

test("legacy public shipment projection remains strict to one complete package", () => {
  assert.equal(projectPublicShipment([]), null);
  assert.equal(projectPublicShipment([shipmentEvent, shipmentEvent]), null);
  assert.equal(projectPublicShipment([shipmentEvent], 1)?.status, "shipped");
});

test("package projection supports multiple packages while invalid journals fail closed", () => {
  const second = createShipmentRecord({
    carrierCode: "fedex",
    trackingNumber: "123456789012",
    quantity: 1,
    shippedAt: "2026-08-24T20:30:00.000Z",
  });
  assert.ok(second);
  const events = [
    shipmentEvent,
    { type: "RECORD_SHIPMENT", detail: JSON.stringify({ shipment: second }) },
  ];
  assert.equal(projectPublicShipment(events, 2), null);
  assert.equal(projectPublicShipments(events, 2).length, 2);
  assert.deepEqual(projectPublicShipments([shipmentEvent, shipmentEvent], 2), []);
});

test("public delivery projection fails closed on duplicate or malformed delivery evidence", () => {
  assert.equal(projectPublicShipment([shipmentEvent, deliveryEvent], 1)?.status, "delivered");
  assert.equal(projectPublicShipment([shipmentEvent, deliveryEvent, deliveryEvent], 1), null);
  assert.equal(
    projectPublicShipment([
      shipmentEvent,
      { type: "MARK_DELIVERED", detail: JSON.stringify({ delivery: { version: 2 } }) },
    ], 1),
    null,
  );
});

test("public delivery projection rejects delivery timestamps before shipment", () => {
  const impossibleDelivery = createDeliveryRecord({
    packageId: shipment.packageId,
    deliveredAt: "2026-08-24T19:59:59.000Z",
  });
  assert.ok(impossibleDelivery);
  assert.equal(
    projectPublicShipment([
      shipmentEvent,
      { type: "MARK_DELIVERED", detail: JSON.stringify({ delivery: impossibleDelivery }) },
    ], 1),
    null,
  );
});

test("customer order API binds public fulfillment label to package totals and internal state", () => {
  assert.match(accountOrdersRoute, /const internalFulfillmentStatus = publicFulfillmentStatus/);
  assert.match(accountOrdersRoute, /const projectedShipments = projectPublicShipments/);
  assert.match(accountOrdersRoute, /const shippedQuantity = projectedShipments\.reduce/);
  assert.match(accountOrdersRoute, /const deliveredQuantity = projectedShipments/);
  assert.match(accountOrdersRoute, /const packageProjectionConsistent/);
  assert.match(accountOrdersRoute, /shippedQuantity === item\.quantity && deliveredQuantity === item\.quantity/);
  assert.match(
    accountOrdersRoute,
    /fulfillmentStatus: fulfillmentConsistent \? internalFulfillmentStatus : "processing"/,
  );
  assert.match(accountOrdersRoute, /shipments: fulfillmentConsistent \? projectedShipments : \[\]/);
});

test("customer fulfillment truth remains read-only and supplier economics stay private", () => {
  assert.doesNotMatch(accountOrdersRoute, /\bupdate\s*\(/);
  assert.doesNotMatch(accountOrdersRoute, /\bcreate\s*\(/);
  assert.doesNotMatch(accountOrdersRoute, /\bdelete\s*\(/);
  for (const forbidden of [
    "supplierSnapshot",
    "supplierOrderReference",
    "actualTotalCostCents",
    "expectedTotalCostCents",
  ]) {
    assert.equal(accountOrdersRoute.includes(forbidden), false, `customer route leaked ${forbidden}`);
  }
});
