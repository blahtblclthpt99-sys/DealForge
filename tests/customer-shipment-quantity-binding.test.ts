import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createShipmentRecord,
  projectPublicShipment,
  projectPublicShipments,
} from "../src/lib/shipment-tracking";

const root = process.cwd();
const accountOrdersRoute = readFileSync(join(root, "src/app/api/account/orders/route.ts"), "utf8");

const shipment = createShipmentRecord({
  carrierCode: "fedex",
  trackingNumber: "123456789012",
  quantity: 2,
  shippedAt: "2026-08-24T20:00:00.000Z",
});
assert.ok(shipment);

const events = [
  {
    type: "RECORD_SHIPMENT",
    detail: JSON.stringify({ shipment }),
  },
];

test("legacy single shipment projection accepts exact authoritative order quantity", () => {
  const projected = projectPublicShipment(events, 2);
  assert.equal(projected?.status, "shipped");
  assert.equal(projected?.trackingNumber, shipment.trackingNumber);
});

test("legacy single shipment projection fails closed on order-to-shipment quantity drift", () => {
  assert.equal(projectPublicShipment(events, 1), null);
  assert.equal(projectPublicShipment(events, 3), null);
});

test("multi-package projection permits partial quantities but never cumulative over-shipment", () => {
  const first = createShipmentRecord({
    carrierCode: "ups",
    trackingNumber: "1Z999AA10123456784",
    quantity: 1,
    shippedAt: "2026-08-24T20:00:00.000Z",
  });
  const second = createShipmentRecord({
    carrierCode: "ups",
    trackingNumber: "1Z999AA10123456785",
    quantity: 1,
    shippedAt: "2026-08-24T20:30:00.000Z",
  });
  assert.ok(first);
  assert.ok(second);
  const firstOnly = [{ type: "RECORD_SHIPMENT", detail: JSON.stringify({ shipment: first }) }];
  assert.equal(projectPublicShipments(firstOnly, 2).length, 1);
  assert.equal(
    projectPublicShipments([
      ...firstOnly,
      { type: "RECORD_SHIPMENT", detail: JSON.stringify({ shipment: second }) },
    ], 2).length,
    2,
  );
  assert.deepEqual(projectPublicShipments(events, 1), []);
});

test("invalid expected order quantities cannot validate shipment evidence", () => {
  assert.equal(projectPublicShipment(events, 0), null);
  assert.equal(projectPublicShipment(events, -1), null);
  assert.equal(projectPublicShipment(events, 1.5), null);
  assert.deepEqual(projectPublicShipments(events, 0), []);
});

test("legacy internal callers may omit expected quantity without weakening customer binding", () => {
  assert.equal(projectPublicShipment(events)?.status, "shipped");
  assert.match(accountOrdersRoute, /projectPublicShipment\(events, item\.quantity\)/);
  assert.match(accountOrdersRoute, /projectPublicShipments\(events, item\.quantity\)/);
  assert.match(accountOrdersRoute, /shippedQuantity <= item\.quantity/);
});

test("customer quantity binding remains read-only", () => {
  assert.doesNotMatch(accountOrdersRoute, /\bupdate\s*\(/);
  assert.doesNotMatch(accountOrdersRoute, /\bcreate\s*\(/);
  assert.doesNotMatch(accountOrdersRoute, /\bdelete\s*\(/);
  assert.doesNotMatch(accountOrdersRoute, /\bfetch\s*\(/);
});
