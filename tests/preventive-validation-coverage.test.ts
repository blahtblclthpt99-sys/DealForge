import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { preventiveValidationCoverage, summarizeValidationCoverage } from "../src/lib/preventive-validation-coverage";

test("maps canonical commerce and inventory failures to deterministic validators", () => {
  const entries = preventiveValidationCoverage();
  const byReason = new Map(entries.map((entry) => [entry.reason, entry]));
  assert.equal(byReason.get("source_verification_stale")?.status, "preflight");
  assert.equal(byReason.get("contribution_profit_below_floor")?.status, "preflight");
  assert.equal(byReason.get("inventory_observation_stale")?.status, "runtime_monitor");
  assert.equal(byReason.get("inventory_confidence_low")?.status, "legacy_alias");
  assert.equal(byReason.get("safety_evidence_requires_review")?.status, "unmapped");
});

test("coverage summary is deterministic and complete", () => {
  const entries = preventiveValidationCoverage();
  const summary = summarizeValidationCoverage(entries);
  assert.equal(summary.total, entries.length);
  assert.equal(summary.total, summary.preflight + summary.persisted_selection + summary.runtime_monitor + summary.legacy_alias + summary.unmapped);
  assert.ok(summary.preflight > summary.runtime_monitor);
  assert.ok(summary.unmapped >= 1);
});

test("coverage matrix remains read-only engineering guidance", async () => {
  const source = await readFile("src/components/preventive-validation-coverage.tsx", "utf8");
  assert.match(source, /read-only engineering coverage view/);
  assert.match(source, /evidence-binding contract/);
  assert.doesNotMatch(source, /prisma\./);
  assert.doesNotMatch(source, /commerceEnabled\s*:\s*true/);
  assert.doesNotMatch(source, /procurementIntent\.(create|update|upsert|delete)/);
});
