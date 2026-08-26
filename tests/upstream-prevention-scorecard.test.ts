import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildUpstreamPreventionScorecard } from "../src/lib/upstream-prevention-scorecard";

test("groups recurring quarantine reasons into prevention domains", () => {
  const scorecard = buildUpstreamPreventionScorecard([
    { reason: "inventory_stale", events: 4, resolved: 3, open: 1, medianResolvedDurationMs: 86_400_000 },
    { reason: "inventory_confidence_low", events: 2, resolved: 2, open: 0, medianResolvedDurationMs: 43_200_000 },
    { reason: "tax_classification_stale", events: 1, resolved: 1, open: 0, medianResolvedDurationMs: 3_600_000 },
  ]);
  const inventory = scorecard.find((entry) => entry.domain === "inventory");
  assert.ok(inventory);
  assert.equal(inventory.events, 6);
  assert.equal(inventory.open, 1);
  assert.deepEqual(inventory.reasons, ["inventory_confidence_low", "inventory_stale"]);
});

test("open recurring failures outrank isolated short-lived failures", () => {
  const scorecard = buildUpstreamPreventionScorecard([
    { reason: "source_verification_stale", events: 5, resolved: 2, open: 3, medianResolvedDurationMs: 259_200_000 },
    { reason: "tax_classification_stale", events: 1, resolved: 1, open: 0, medianResolvedDurationMs: 3_600_000 },
  ]);
  assert.equal(scorecard[0].domain, "supplier");
  assert.ok(scorecard[0].score > scorecard[1].score);
});

test("scores are deterministic and bounded", () => {
  const input = [{ reason: "landed_cost_invalid", events: 50, resolved: 25, open: 25, medianResolvedDurationMs: 999_999_999 }];
  const a = buildUpstreamPreventionScorecard(input);
  const b = buildUpstreamPreventionScorecard(input);
  assert.deepEqual(a, b);
  assert.equal(a[0].score, 100);
});

test("owner scorecard surface remains read-only advisory", async () => {
  const source = await readFile("src/components/upstream-prevention-scorecard.tsx", "utf8");
  assert.match(source, /Scores are advisory/);
  assert.match(source, /not an automatic rejection threshold/);
  assert.doesNotMatch(source, /prisma\.product\.(update|updateMany|upsert|create|delete)/);
  assert.doesNotMatch(source, /procurementIntent\.(create|update|upsert|delete)/);
  assert.doesNotMatch(source, /commerceEnabled\s*:\s*true/);
});
