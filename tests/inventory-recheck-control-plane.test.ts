import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("inventory recheck queue is additive, bounded, and durable", async () => {
  const migration = await readFile(
    "prisma/migrations/20260825162500_inventory_recheck_control_plane_v1/migration.sql",
    "utf8",
  );
  assert.match(migration, /CREATE TABLE "InventoryRecheckJob"/);
  assert.match(migration, /"idempotencyKey" TEXT NOT NULL/);
  assert.match(migration, /'pending','leased','retry','completed','dead_letter'/);
  assert.match(migration, /"maxAttempts" BETWEEN 1 AND 12/);
  assert.match(migration, /FOREIGN KEY \("supplierOfferId"\) REFERENCES "SupplierOffer"/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/i);
});

test("recheck claims are source-scoped, leased, bounded, and skip locked", async () => {
  const source = await readFile("src/lib/inventory-recheck.ts", "utf8");
  assert.match(source, /MAX_CLAIM_BATCH = 25/);
  assert.match(source, /MIN_LEASE_SECONDS = 30/);
  assert.match(source, /MAX_LEASE_SECONDS = 15 \* 60/);
  assert.match(source, /WHERE "sourceKey" = \$\{sourceKey\}/);
  assert.match(source, /FOR UPDATE SKIP LOCKED/);
  assert.match(source, /"attemptCount" = job\."attemptCount" \+ 1/);
  assert.match(source, /"leaseExpiresAt" <= \$\{now\}/);
  assert.match(source, /productEnginePaused/);
});

test("recheck failures use bounded exponential retry and dead-letter handling", async () => {
  const source = await readFile("src/lib/inventory-recheck.ts", "utf8");
  assert.match(source, /job\.attemptCount >= job\.maxAttempts/);
  assert.match(source, /Math\.min\(3600, 60 \* 2 \*\* Math\.max\(0, job\.attemptCount - 1\)\)/);
  assert.match(source, /dead_letter/);
  assert.match(source, /inventory_recheck_dead_lettered/);
  assert.match(source, /inventory_recheck_retry_scheduled/);
  assert.match(source, /RECHECK_LEASE_INVALID/);
});

test("control plane cannot promote commerce or purchase inventory", async () => {
  const source = await readFile("src/lib/inventory-recheck.ts", "utf8");
  assert.doesNotMatch(source, /commerceEnabled\s*:\s*true/);
  assert.doesNotMatch(source, /stripe|checkout|paymentIntent|purchase|procurementIntent\.create/i);
  assert.match(source, /supplier\.resaleAllowed/);
});

test("owner inventory API exposes bounded recheck operations behind existing controls", async () => {
  const route = await readFile("src/app/api/admin/inventory/route.ts", "utf8");
  assert.match(route, /requireOwner/);
  assert.match(route, /sameOrigin\(req\)/);
  assert.match(route, /readLimitedJson\(req, 24 \* 1024\)/);
  assert.match(route, /schedule_recheck/);
  assert.match(route, /claim_rechecks/);
  assert.match(route, /complete_recheck/);
  assert.match(route, /fail_recheck/);
  assert.match(route, /max\(25\)/);
  assert.match(route, /max\(900\)/);
  assert.match(route, /inventoryRecheckQueueSummary/);
});
