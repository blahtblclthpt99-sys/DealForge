import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveMaintenanceToken } from "../src/lib/maintenance-token";

test("Cloudflare cron runs the commerce safety monitor every five minutes", async () => {
  const config = await readFile("wrangler.jsonc", "utf8");
  const worker = await readFile("custom-worker.ts", "utf8");

  assert.match(config, /"main": "\.\/custom-worker\.ts"/);
  assert.match(config, /"crons": \["\*\/5 \* \* \* \*"\]/);
  assert.match(worker, /async scheduled/);
  assert.match(worker, /\/api\/internal\/commerce-monitor/);
  assert.match(worker, /x-dealforge-maintenance-token/);
  assert.match(worker, /resolveMaintenanceToken\(env\)/);
  assert.doesNotMatch(worker, /env\.MAINTENANCE_TOKEN \|\| env\.AUTH_SECRET/);
});

test("internal monitor route fails closed without a valid maintenance credential", async () => {
  const route = await readFile("src/app/api/internal/commerce-monitor/route.ts", "utf8");

  assert.match(route, /resolveMaintenanceToken\(\)/);
  assert.doesNotMatch(route, /MAINTENANCE_TOKEN \|\| process\.env\.AUTH_SECRET/);
  assert.match(route, /status: 401/);
  assert.match(route, /pauseUnsafeCommerceProducts\("cloudflare-cron"\)/);
});

test("maintenance token prefers a dedicated secret and rejects short values", () => {
  const dedicated = "dedicated-maintenance-token-long-enough";
  assert.equal(
    resolveMaintenanceToken({ MAINTENANCE_TOKEN: dedicated, AUTH_SECRET: "unused" }),
    dedicated,
  );
  assert.equal(
    resolveMaintenanceToken({ MAINTENANCE_TOKEN: "too-short", AUTH_SECRET: "unused" }),
    "",
  );
});

test("maintenance fallback is one-way derived instead of reusing AUTH_SECRET as bearer token", () => {
  const authSecret = "8vF9pQ2sLm7xR4cN1zK6wT3yH5jD0bUaE9gS2mV7";
  const derived = resolveMaintenanceToken({ AUTH_SECRET: authSecret });

  assert.match(derived, /^[a-f0-9]{64}$/);
  assert.notEqual(derived, authSecret);
  assert.equal(resolveMaintenanceToken({ AUTH_SECRET: "dev-insecure-secret" }), "");
  assert.equal(resolveMaintenanceToken({}), "");
});
