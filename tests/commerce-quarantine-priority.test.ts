import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { CommerceQuarantineRecord } from "../src/lib/commerce-quarantine";
import {
  calculateQuarantinePriority,
  rankQuarantineRecoveryQueue,
} from "../src/lib/commerce-quarantine-priority";

const now = new Date("2026-08-26T04:00:00.000Z");

function record(overrides: Partial<CommerceQuarantineRecord> = {}): CommerceQuarantineRecord {
  return {
    auditId: "q1",
    productId: "p1",
    action: "commerce_auto_paused",
    reasons: ["inventory_stale"],
    quarantinedAt: new Date("2026-08-25T04:00:00.000Z"),
    recoverySteps: ["Refresh inventory."],
    ...overrides,
  };
}

function product(overrides: Partial<{ id: string; sellingPriceCents: number | null; viewCount: number; clickCount: number; trendingScore: number; availability: string }> = {}) {
  return {
    id: "p1",
    sellingPriceCents: 2999,
    viewCount: 100,
    clickCount: 10,
    trendingScore: 25,
    availability: "in_stock",
    ...overrides,
  };
}

test("safety-critical blocker outranks high-demand stale inventory", () => {
  const critical = calculateQuarantinePriority(
    record({ productId: "critical", reasons: ["resale_not_verified"] }),
    product({ id: "critical", sellingPriceCents: 999, viewCount: 0, clickCount: 0, trendingScore: 0 }),
    now,
  );
  const popularStale = calculateQuarantinePriority(
    record({ productId: "popular", reasons: ["inventory_stale"] }),
    product({ id: "popular", sellingPriceCents: 250000, viewCount: 100000, clickCount: 5000, trendingScore: 100 }),
    now,
  );

  assert.ok(critical.reasonRiskScore > popularStale.reasonRiskScore);
  assert.ok(critical.score > popularStale.score);
});

test("priority score is deterministic and bounded", () => {
  const first = calculateQuarantinePriority(record(), product(), now);
  const second = calculateQuarantinePriority(record(), product(), now);
  assert.deepEqual(first, second);
  assert.ok(first.score >= 0 && first.score <= 1000);
  assert.ok(first.demandScore >= 0 && first.demandScore <= 100);
  assert.ok(first.estimatedExposureScore >= 0 && first.estimatedExposureScore <= 100);
});

test("blocked age saturates after seven days", () => {
  const sevenDays = calculateQuarantinePriority(
    record({ quarantinedAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) }),
    product(),
    now,
  );
  const thirtyDays = calculateQuarantinePriority(
    record({ quarantinedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) }),
    product(),
    now,
  );
  assert.equal(sevenDays.ageScore, 100);
  assert.equal(thirtyDays.ageScore, 100);
});

test("ranking is highest score first and stable by oldest quarantine on tie", () => {
  const records = [
    record({ auditId: "new", productId: "p-new", quarantinedAt: new Date("2026-08-25T06:00:00.000Z") }),
    record({ auditId: "old", productId: "p-old", quarantinedAt: new Date("2026-08-25T05:00:00.000Z") }),
  ];
  const products = [
    product({ id: "p-new" }),
    product({ id: "p-old" }),
  ];
  const ranked = rankQuarantineRecoveryQueue(records, products, now);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].record.productId, "p-old");
});

test("owner analytics UI is read-only and labels exposure as heuristic", async () => {
  const source = await readFile("src/components/commerce-quarantine-queue.tsx", "utf8");
  assert.match(source, /rankQuarantineRecoveryQueue/);
  assert.match(source, /Demand\/exposure scores are bounded triage heuristics, not revenue forecasts/);
  assert.match(source, /Priority scores never enable commerce/);
  assert.doesNotMatch(source, /prisma\.product\.(update|updateMany|upsert|create|delete)/);
  assert.doesNotMatch(source, /procurementIntent\.(create|update|upsert|delete)/);
});
