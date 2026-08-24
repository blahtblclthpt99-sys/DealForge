import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Cloudflare cron runs the commerce safety monitor every five minutes", async () => {
  const config = await readFile("wrangler.jsonc", "utf8");
  const worker = await readFile("custom-worker.ts", "utf8");

  assert.match(config, /"main": "\.\/custom-worker\.ts"/);
  assert.match(config, /"crons": \["\*\/5 \* \* \* \*"\]/);
  assert.match(worker, /async scheduled/);
  assert.match(worker, /\/api\/internal\/commerce-monitor/);
  assert.match(worker, /x-dealforge-maintenance-token/);
});

test("internal monitor route fails closed without the server maintenance secret", async () => {
  const route = await readFile("src/app/api/internal/commerce-monitor/route.ts", "utf8");

  assert.match(route, /MAINTENANCE_TOKEN \|\| process\.env\.AUTH_SECRET/);
  assert.match(route, /expected\.length >= 24/);
  assert.match(route, /status: 401/);
  assert.match(route, /pauseUnsafeCommerceProducts\("cloudflare-cron"\)/);
});
