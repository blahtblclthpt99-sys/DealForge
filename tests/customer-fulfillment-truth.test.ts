import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createShipmentRecord,
  projectPublicShipment,
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

const deliveryEvent = {
  type: "MARK_DELIVERED",
  detail: JSON.stringify({
    delivery: { version: 1, deliveredAt: "2026-08-24T21:00:00.000Z" },
  }),
};

test("public shipment projection requires exactly one shipment journal event", () => {
  assert.equal(projectPublicShipment([]), null);
  assert.equal(projectPublicShipment([shipmentEvent, shipmentEvent]), null);
  assert.equal(projectPublicShipment([shipmentEvent])?.status, "shipped");
});

test("public delivery projection fails closed on duplicate or malformed delivery evidence", () => {
  assert.equal(projectPublicShipment([shipmentEvent, deliveryEvent])?.status, "delivered");
  assert.equal(projectPublicShipment([shipmentEvent, deliveryEvent, deliveryEvent]), null);
  assert.equal(
    projectPublicShipment([
      shipmentEvent,
      { type: "MARK_DELIVERED", detail: JSON.stringify({ delivery: { version: 1 } }) },
    ]),
    null,
  );
});

test("public delivery projection rejects delivery timestamps before shipment", () => {
  const impossibleDelivery = {
    type: "MARK_DELIVERED",
    detail: JSON.stringify({
      delivery: { version: 1, deliveredAt: "2026-08-24T19:59:59.000Z" },
    }),
  };
  assert.equal(projectPublicShipment([shipmentEvent, impossibleDelivery]), null);
});

test("customer order API binds public fulfillment label and tracking to the same journal projection", () => {
  assert.match(accountOrdersRoute, /const internalFulfillmentStatus = publicFulfillmentStatus/);
  assert.match(accountOrdersRoute, /const projectedShipment = projectPublicShipment/);
  assert.match(accountOrdersRoute, /projectedShipment\?\.status === internalFulfillmentStatus/);
  assert.match(
    accountOrdersRoute,
    /fulfillmentStatus: fulfillmentConsistent \? internalFulfillmentStatus : "processing"/,
  );
  assert.match(accountOrdersRoute, /shipment: fulfillmentConsistent \? projectedShipment : null/);
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
