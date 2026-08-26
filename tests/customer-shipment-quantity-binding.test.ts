import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createShipmentRecord, projectPublicShipment } from "../src/lib/shipment-tracking";

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

test("public shipment projection accepts the exact authoritative order quantity", () => {
  const projected = projectPublicShipment(events, 2);
  assert.equal(projected?.status, "shipped");
  assert.equal(projected?.trackingNumber, shipment.trackingNumber);
});

test("public shipment projection fails closed on order-to-shipment quantity drift", () => {
  assert.equal(projectPublicShipment(events, 1), null);
  assert.equal(projectPublicShipment(events, 3), null);
});

test("invalid expected order quantities cannot validate shipment evidence", () => {
  assert.equal(projectPublicShipment(events, 0), null);
  assert.equal(projectPublicShipment(events, -1), null);
  assert.equal(projectPublicShipment(events, 1.5), null);
});

test("legacy internal callers may omit expected quantity without weakening customer binding", () => {
  assert.equal(projectPublicShipment(events)?.status, "shipped");
  assert.match(
    accountOrdersRoute,
    /projectPublicShipment\(\s*item\.procurementIntent\?\.events \|\| \[\],\s*item\.quantity,?\s*\)/,
  );
});

test("customer quantity binding remains read-only", () => {
  assert.doesNotMatch(accountOrdersRoute, /\bupdate\s*\(/);
  assert.doesNotMatch(accountOrdersRoute, /\bcreate\s*\(/);
  assert.doesNotMatch(accountOrdersRoute, /\bdelete\s*\(/);
  assert.doesNotMatch(accountOrdersRoute, /\bfetch\s*\(/);
});
