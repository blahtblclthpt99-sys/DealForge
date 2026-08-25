import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("adapter authentication is HMAC signed, constant-time, source-scoped, and disabled by default", async () => {
  const source = await readFile("src/lib/inventory-adapter-auth.ts", "utf8");
  assert.match(source, /INVENTORY_ADAPTER_SECRETS_JSON/);
  assert.match(source, /ADAPTER_AUTH_NOT_CONFIGURED/);
  assert.match(source, /createHmac\("sha256", entry\.secret\)/);
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /entry\.sourceKeys\.includes\(sourceKey\)/);
  assert.match(source, /MAX_CLOCK_SKEW_SECONDS = 300/);
  assert.match(source, /ADAPTER_SCOPE_FORBIDDEN/);
  assert.match(source, /ADAPTER_SIGNATURE_INVALID/);
});

test("adapter requests have durable replay protection", async () => {
  const source = await readFile("src/lib/inventory-adapter-auth.ts", "utf8");
  const migration = await readFile(
    "prisma/migrations/20260825163500_inventory_adapter_nonce_v1/migration.sql",
    "utf8",
  );
  assert.match(source, /InventoryAdapterNonce/);
  assert.match(source, /ON CONFLICT \("nonceHash"\) DO NOTHING/);
  assert.match(source, /ADAPTER_REPLAY_DETECTED/);
  assert.match(migration, /CREATE TABLE "InventoryAdapterNonce"/);
  assert.match(migration, /CREATE UNIQUE INDEX "InventoryAdapterNonce_nonceHash_key"/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/i);
});

test("machine route authenticates raw bytes before JSON parsing", async () => {
  const route = await readFile("src/app/api/internal/inventory-adapter/route.ts", "utf8");
  const rawIndex = route.indexOf("const rawBody = await readRawBody(req)");
  const authIndex = route.indexOf("authenticateInventoryAdapterRequest");
  const parseIndex = route.indexOf("JSON.parse(rawBody)");
  assert.ok(rawIndex >= 0);
  assert.ok(authIndex >= 0);
  assert.ok(parseIndex >= 0);
  assert.ok(authIndex < parseIndex, "signature verification must happen before JSON parsing/action execution");
  assert.match(route, /MAX_BODY_BYTES = 24 \* 1024/);
  assert.match(route, /Cache-Control": "no-store"/);
});

test("machine observations are bound to the exact authenticated leased offer", async () => {
  const route = await readFile("src/app/api/internal/inventory-adapter/route.ts", "utf8");
  const lease = await readFile("src/lib/inventory-recheck-lease.ts", "utf8");
  assert.doesNotMatch(route, /observationSchema[\s\S]*supplierOfferId:/);
  assert.match(route, /resolveInventoryRecheckLease/);
  assert.match(route, /sourceKey: identity\.sourceKey/);
  assert.match(route, /supplierOfferId: lease\.supplierOfferId/);
  assert.match(lease, /AND "sourceKey" = \$\{sourceKey\}/);
  assert.match(lease, /AND "leaseExpiresAt" > \$\{now\}/);
});

test("machine endpoint is bounded and has no financial or procurement authority", async () => {
  const route = await readFile("src/app/api/internal/inventory-adapter/route.ts", "utf8");
  assert.match(route, /max\(25\)/);
  assert.match(route, /max\(900\)/);
  assert.match(route, /MAX_NEXT_RECHECK_MS = 7 \* 24 \* 60 \* 60_000/);
  assert.doesNotMatch(route, /commerceEnabled\s*:\s*true/);
  assert.doesNotMatch(route, /stripe|paymentIntent|checkoutSession|procurementIntent\.create|purchase/i);
  assert.doesNotMatch(route, /scheduleInventoryRecheck/);
});

test("stale adapter observations cannot silently complete leased work", async () => {
  const route = await readFile("src/app/api/internal/inventory-adapter/route.ts", "utf8");
  assert.match(route, /observed\.applied === false/);
  assert.match(route, /OLDER_THAN_CURRENT_OBSERVATION/);
  assert.match(route, /failInventoryRecheck/);
  assert.match(route, /ADAPTER_OBSERVATION_NOT_CURRENT/);
});
