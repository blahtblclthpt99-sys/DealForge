import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("commerce monitor evaluates product tax evidence before preserving eligibility", async () => {
  const source = await readFile("src/lib/commerce-monitor.ts", "utf8");
  assert.match(source, /evaluateProductTaxClassification\(product\.specifications, nowMs\)/);
  assert.match(source, /allowed: commercial\.allowed && tax\.allowed/);
  assert.match(source, /tax\.reasons/);
  assert.match(source, /data: \{ commerceEnabled: false \}/);
  assert.doesNotMatch(source, /data: \{ commerceEnabled: true \}/);
});

test("Cloudflare maintenance monitor also sweeps current persisted inventory evidence", async () => {
  const route = await readFile("src/app/api/internal/commerce-monitor/route.ts", "utf8");
  const commerceIndex = route.indexOf('pauseUnsafeCommerceProducts("cloudflare-cron")');
  const inventoryIndex = route.indexOf('sweepInventoryFreshness("cloudflare-cron", 250)');
  assert.ok(commerceIndex >= 0);
  assert.ok(inventoryIndex > commerceIndex);
  assert.match(route, /x-dealforge-maintenance-token/);
  assert.match(route, /Cache-Control": "no-store/);
});

test("automatic inventory sweep remains monotonic-safe", async () => {
  const source = await readFile("src/lib/inventory-operations.ts", "utf8");
  assert.match(source, /data: \{[\s\S]*?commerceEnabled: false,[\s\S]*?availability,[\s\S]*?\}/);
  assert.match(source, /requireCurrent: true/);
  assert.match(source, /observed_supplier_price_drift/);
  assert.doesNotMatch(source, /data:\s*\{\s*commerceEnabled:\s*true/);
});
