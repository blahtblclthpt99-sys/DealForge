import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const worker = readFileSync("src/workers/order-operations-monitor.ts", "utf8");
const maintenance = readFileSync("src/app/api/internal/maintenance/route.ts", "utf8");

test("order operations monitor is observational and paid-order scoped", () => {
  assert.match(worker, /where:\s*\{\s*status:\s*"paid",\s*paidAt:\s*\{\s*not:\s*null\s*\}/);
  assert.match(worker, /orderOperationsAlertFingerprint/);
  assert.match(worker, /automaticOrderActionsEnabled:\s*false/);
  assert.match(worker, /automaticSupplierPurchasingEnabled:\s*false/);
  assert.doesNotMatch(worker, /prisma\.order\.(?:create|update|updateMany|delete|deleteMany|upsert)/);
  assert.doesNotMatch(worker, /prisma\.product\./);
  assert.doesNotMatch(worker, /stripe-commerce|api\.stripe\.com|createStripe|refund/i);
});

test("scheduled maintenance runs order operations monitor without replacing commerce quarantine", () => {
  assert.match(maintenance, /quarantineUnsafeDirectCommerce\(500\)/);
  assert.match(maintenance, /monitorOrderOperations\(200\)/);
  assert.ok(
    maintenance.indexOf("quarantineUnsafeDirectCommerce(500)") < maintenance.indexOf("monitorOrderOperations(200)"),
    "direct-commerce quarantine must run before order operations monitoring",
  );
});
