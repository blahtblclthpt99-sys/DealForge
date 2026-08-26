import assert from "node:assert/strict";
import test from "node:test";
import type { CommerceQuarantineAudit } from "../src/lib/commerce-quarantine";
import {
  calculateQuarantinePerformanceAnalytics,
  deriveQuarantineEpisodes,
} from "../src/lib/commerce-quarantine-analytics";

const now = new Date("2026-08-26T04:00:00.000Z");

function quarantine(
  id: string,
  productId: string,
  createdAt: string,
  reasons: string[],
): CommerceQuarantineAudit {
  return {
    id,
    action: "commerce_auto_paused",
    detail: JSON.stringify({ productId, reasons }),
    createdAt: new Date(createdAt),
  };
}

function resolution(
  id: string,
  quarantineAuditId: string,
  productId: string,
  quarantinedAt: string,
  resolvedAt: string,
  blockedDurationMs: number,
  quarantineReasons: string[],
): CommerceQuarantineAudit {
  return {
    id,
    action: "commerce_quarantine_resolved",
    detail: JSON.stringify({
      productId,
      quarantineAuditId,
      quarantinedAt,
      resolvedAt,
      blockedDurationMs,
      quarantineReasons,
    }),
    createdAt: new Date(resolvedAt),
  };
}

test("derives linked quarantine episodes and excludes malformed audit rows", () => {
  const audits: CommerceQuarantineAudit[] = [
    quarantine("q1", "p1", "2026-08-20T04:00:00.000Z", ["inventory_stale"]),
    resolution("r1", "q1", "p1", "2026-08-20T04:00:00.000Z", "2026-08-20T10:00:00.000Z", 6 * 60 * 60 * 1000, ["inventory_stale"]),
    { id: "bad", action: "commerce_auto_paused", detail: "{not-json", createdAt: new Date("2026-08-21T04:00:00.000Z") },
  ];

  const episodes = deriveQuarantineEpisodes(audits);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].auditId, "q1");
  assert.equal(episodes[0].productId, "p1");
  assert.equal(episodes[0].blockedDurationMs, 6 * 60 * 60 * 1000);
  assert.equal(episodes[0].resolvedAt?.toISOString(), "2026-08-20T10:00:00.000Z");
});

test("calculates recovery rate, median downtime, repeat products, and reason concentration", () => {
  const audits: CommerceQuarantineAudit[] = [
    quarantine("q1", "p1", "2026-08-19T04:00:00.000Z", ["inventory_stale"]),
    resolution("r1", "q1", "p1", "2026-08-19T04:00:00.000Z", "2026-08-19T06:00:00.000Z", 2 * 60 * 60 * 1000, ["inventory_stale"]),
    quarantine("q2", "p1", "2026-08-22T04:00:00.000Z", ["inventory_stale", "observed_supplier_price_drift"]),
    resolution("r2", "q2", "p1", "2026-08-22T04:00:00.000Z", "2026-08-22T10:00:00.000Z", 6 * 60 * 60 * 1000, ["inventory_stale", "observed_supplier_price_drift"]),
    quarantine("q3", "p2", "2026-08-25T04:00:00.000Z", ["tax_classification_stale"]),
  ];

  const analytics = calculateQuarantinePerformanceAnalytics(audits, now);
  assert.equal(analytics.totalEvents, 3);
  assert.equal(analytics.resolvedEvents, 2);
  assert.equal(analytics.openEvents, 1);
  assert.equal(analytics.recoveryRatePct, 67);
  assert.equal(analytics.medianResolvedDurationMs, 4 * 60 * 60 * 1000);
  assert.equal(analytics.repeatProductCount, 1);
  assert.equal(analytics.products[0].productId, "p1");
  assert.equal(analytics.products[0].events, 2);
  assert.equal(analytics.reasons[0].reason, "inventory_stale");
  assert.equal(analytics.reasons[0].events, 2);
  assert.equal(analytics.reasons[0].resolved, 2);
});

test("compares recent seven-day quarantine volume with the prior seven-day window", () => {
  const audits: CommerceQuarantineAudit[] = [
    quarantine("recent-1", "p1", "2026-08-25T04:00:00.000Z", ["inventory_stale"]),
    quarantine("recent-2", "p2", "2026-08-24T04:00:00.000Z", ["inventory_stale"]),
    quarantine("recent-3", "p3", "2026-08-23T04:00:00.000Z", ["inventory_stale"]),
    quarantine("prior-1", "p4", "2026-08-17T04:00:00.000Z", ["inventory_stale"]),
  ];
  const analytics = calculateQuarantinePerformanceAnalytics(audits, now);
  assert.equal(analytics.recent7dEvents, 3);
  assert.equal(analytics.prior7dEvents, 1);
  assert.equal(analytics.sevenDayDeltaPct, 200);
});

test("analytics are deterministic for a fixed audit set and clock", () => {
  const audits = [quarantine("q1", "p1", "2026-08-25T04:00:00.000Z", ["inventory_stale"])];
  assert.deepEqual(
    calculateQuarantinePerformanceAnalytics(audits, now),
    calculateQuarantinePerformanceAnalytics(audits, now),
  );
});
