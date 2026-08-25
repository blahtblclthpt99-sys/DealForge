import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveInventoryAdapterRatePolicy } from "../src/lib/inventory-adapter-rate-limit";

test("inventory adapter pacing has conservative defaults and exact source overrides", () => {
  assert.deepEqual(resolveInventoryAdapterRatePolicy("supplier-a", ""), {
    windowSeconds: 60,
    maxRequests: 30,
    maxClaimUnits: 50,
    maxClaimItems: 5,
  });

  const configured = JSON.stringify({
    "*": { windowSeconds: 120, maxRequests: 20, maxClaimUnits: 30, maxClaimItems: 4 },
    "supplier-a": { maxRequests: 8, maxClaimUnits: 12, maxClaimItems: 2 },
  });
  assert.deepEqual(resolveInventoryAdapterRatePolicy("supplier-a", configured), {
    windowSeconds: 120,
    maxRequests: 8,
    maxClaimUnits: 12,
    maxClaimItems: 2,
  });
  assert.deepEqual(resolveInventoryAdapterRatePolicy("supplier-b", configured), {
    windowSeconds: 120,
    maxRequests: 20,
    maxClaimUnits: 30,
    maxClaimItems: 4,
  });
});

test("configured invalid pacing policy fails closed", () => {
  assert.throws(
    () => resolveInventoryAdapterRatePolicy("supplier-a", "not-json"),
    /ADAPTER_RATE_LIMIT_CONFIG_INVALID/,
  );
  assert.throws(
    () => resolveInventoryAdapterRatePolicy("supplier-a", JSON.stringify({ "*": { maxRequests: 0 } })),
    /ADAPTER_RATE_LIMIT_CONFIG_INVALID/,
  );
  assert.throws(
    () => resolveInventoryAdapterRatePolicy("supplier-a", JSON.stringify({ "supplier-a": { maxClaimItems: 26 } })),
    /ADAPTER_RATE_LIMIT_CONFIG_INVALID/,
  );
});

test("rate windows are durable, source-isolated, and concurrency-safe", async () => {
  const source = await readFile("src/lib/inventory-adapter-rate-limit.ts", "utf8");
  const migration = await readFile(
    "prisma/migrations/20260825165000_inventory_adapter_rate_windows_v1/migration.sql",
    "utf8",
  );

  assert.match(source, /INVENTORY_ADAPTER_RATE_LIMITS_JSON/);
  assert.match(source, /ON CONFLICT \("adapterId", "sourceKey", "windowStart"\) DO UPDATE/);
  assert.match(source, /"requestCount" \+ \$\{requestIncrement\} <= \$\{policy\.maxRequests\}/);
  assert.match(source, /"claimUnits" \+ \$\{claimUnits\} <= \$\{policy\.maxClaimUnits\}/);
  assert.match(source, /ADAPTER_RATE_LIMITED/);
  assert.match(source, /ADAPTER_CLAIM_LIMIT_EXCEEDED/);

  assert.match(migration, /CREATE TABLE "InventoryAdapterRateWindow"/);
  assert.match(migration, /"adapterId" TEXT NOT NULL/);
  assert.match(migration, /"sourceKey" TEXT NOT NULL/);
  assert.match(migration, /CREATE UNIQUE INDEX "InventoryAdapterRateWindow_scope_window_key"/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/i);
});

test("signed machine route consumes request budget before parsing and claim budget before leasing", async () => {
  const route = await readFile("src/app/api/internal/inventory-adapter/route.ts", "utf8");
  const authIndex = route.indexOf("await authenticateInventoryAdapterRequest");
  const requestLimitIndex = route.indexOf("await consumeInventoryAdapterRateLimit({ identity, requestIncrement: 1, claimUnits: 0 })");
  const parseIndex = route.indexOf("JSON.parse(rawBody)");
  const claimBlock = route.indexOf('if (parsed.data.action === "claim")');
  const claimLimitIndex = route.indexOf("await consumeInventoryAdapterRateLimit({", claimBlock);
  const leaseClaimIndex = route.indexOf("await claimDueInventoryRechecks({", claimBlock);

  assert.ok(authIndex >= 0 && requestLimitIndex >= 0 && parseIndex >= 0);
  assert.ok(authIndex < requestLimitIndex, "authenticate before pacing ledger write");
  assert.ok(requestLimitIndex < parseIndex, "valid signed requests are paced before JSON/action work");
  assert.ok(claimLimitIndex > claimBlock && claimLimitIndex < leaseClaimIndex, "claim-unit pacing precedes queue leasing");
  assert.match(route, /status: 429/);
  assert.match(route, /"Retry-After": String\(error\.retryAfterSeconds\)/);
  assert.match(route, /ADAPTER_RATE_LIMIT_CONFIG_INVALID/);
});
