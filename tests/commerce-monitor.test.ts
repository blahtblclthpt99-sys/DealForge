import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("commerce monitor is one-way and never auto-enables products", async () => {
  const source = await readFile("src/lib/commerce-monitor.ts", "utf8");

  assert.match(source, /where: \{ commerceEnabled: true \}/);
  assert.match(source, /data: \{ commerceEnabled: false \}/);
  assert.doesNotMatch(source, /data: \{ commerceEnabled: true \}/);
  assert.match(source, /commerce_auto_paused/);
  assert.match(source, /decision\.reasons/);
});

test("commerce monitor preserves the internal Stripe certification product", async () => {
  const source = await readFile("src/lib/commerce-monitor.ts", "utf8");

  assert.match(source, /CERTIFICATION_PRODUCT_ID/);
  assert.match(source, /internalCertification/);
  assert.match(source, /certificationSkipped/);
});

test("maintenance worker runs the commerce monitor before Product Engine work", async () => {
  const source = await readFile("src/workers/index.ts", "utf8");
  const monitorIndex = source.indexOf("pauseUnsafeCommerceProducts");
  const engineIndex = source.indexOf('runProductEngine("maintenance-worker")');

  assert.ok(monitorIndex >= 0);
  assert.ok(engineIndex > monitorIndex);
});
