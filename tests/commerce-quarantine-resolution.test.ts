import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  COMMERCE_QUARANTINE_RESOLUTION_ACTION,
  deriveCommerceQuarantineRecords,
  deriveCommerceQuarantineResolutions,
  quarantineResolutionAuditId,
} from "../src/lib/commerce-quarantine";

test("resolved quarantine is removed from the open recovery set and preserved in history", () => {
  const quarantinedAt = new Date("2026-08-26T01:00:00.000Z");
  const resolvedAt = new Date("2026-08-26T03:30:00.000Z");
  const quarantine = {
    id: "q1",
    action: "commerce_auto_paused",
    detail: JSON.stringify({ productId: "p1", reasons: ["tax_classification_stale", "inventory_stale"] }),
    createdAt: quarantinedAt,
  };
  const resolution = {
    id: quarantineResolutionAuditId(quarantine.id),
    action: COMMERCE_QUARANTINE_RESOLUTION_ACTION,
    detail: JSON.stringify({
      productId: "p1",
      quarantineAuditId: "q1",
      quarantineReasons: ["tax_classification_stale", "inventory_stale"],
      quarantinedAt: quarantinedAt.toISOString(),
      resolvedAt: resolvedAt.toISOString(),
      blockedDurationMs: resolvedAt.getTime() - quarantinedAt.getTime(),
    }),
    createdAt: resolvedAt,
  };

  assert.deepEqual(deriveCommerceQuarantineRecords([resolution, quarantine]), []);
  const history = deriveCommerceQuarantineResolutions([resolution, quarantine]);
  assert.equal(history.length, 1);
  assert.equal(history[0].quarantineAuditId, "q1");
  assert.deepEqual(history[0].quarantineReasons, ["tax_classification_stale", "inventory_stale"]);
  assert.equal(history[0].blockedDurationMs, 9_000_000);
});

test("resolution audit id is deterministic for idempotent recovery history", () => {
  assert.equal(quarantineResolutionAuditId("abc123"), "quarantine-resolution:abc123");
  assert.equal(quarantineResolutionAuditId("abc123"), quarantineResolutionAuditId("abc123"));
});

test("commercialization records resolution only through the existing successful owner gate", async () => {
  const route = await readFile("src/app/api/admin/product-engine/route.ts", "utf8");
  assert.match(route, /!product\.commerceEnabled && prepared\.commerceEnabled/);
  assert.match(route, /latestOpenQuarantine\(product\.id\)/);
  assert.match(route, /saved\.commerceEnabled/);
  assert.match(route, /action: COMMERCE_QUARANTINE_RESOLUTION_ACTION/);
  assert.match(route, /quarantineAuditId: recovery\.auditId/);
  assert.match(route, /blockedDurationMs/);
  assert.match(route, /refreshedEvidence/);
  assert.match(route, /quarantineResolutionAuditId\(recovery\.auditId\)/);
  assert.match(route, /tx\.productEngineAudit\.upsert/);
  assert.doesNotMatch(route, /process\.env\.COMMERCE_ENABLED\s*=/);
  assert.doesNotMatch(route, /procurementIntent\.(create|update|upsert|delete)/);
});

test("owner recovery UI exposes immutable resolution history without a resume mutation", async () => {
  const source = await readFile("src/components/commerce-quarantine-queue.tsx", "utf8");
  assert.match(source, /Resolved quarantine history/);
  assert.match(source, /deriveCommerceQuarantineResolutions/);
  assert.match(source, /blocked \{formatDuration/);
  assert.match(source, /read-only/);
  assert.doesNotMatch(source, /prisma\.product\.(update|updateMany|upsert|create|delete)/);
  assert.doesNotMatch(source, /data:\s*\{[^}]*commerceEnabled:\s*true/s);
});
