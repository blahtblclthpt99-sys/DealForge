import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deriveCommerceQuarantineRecords, recoveryStepsForReasons } from "../src/lib/commerce-quarantine";

test("latest quarantine event wins per product and preserves exact reasons", () => {
  const now = new Date("2026-08-26T02:00:00.000Z");
  const records = deriveCommerceQuarantineRecords([
    {
      id: "new",
      action: "commerce_auto_paused",
      detail: JSON.stringify({ productId: "p1", reasons: ["tax_classification_stale", "supplier_cost_verification_stale"] }),
      createdAt: now,
    },
    {
      id: "old",
      action: "inventory_product_demoted",
      detail: JSON.stringify({ productId: "p1", reasons: ["inventory_stale"] }),
      createdAt: new Date(now.getTime() - 60_000),
    },
  ]);

  assert.equal(records.length, 1);
  assert.equal(records[0].auditId, "new");
  assert.deepEqual(records[0].reasons, ["tax_classification_stale", "supplier_cost_verification_stale"]);
});

test("recovery guidance ends at owner re-commercialization rather than auto-resume", () => {
  const steps = recoveryStepsForReasons(["observed_supplier_price_drift", "tax_classification_stale"]);
  assert.ok(steps.some((step) => step.includes("Re-verify supplier cost")));
  assert.ok(steps.some((step) => step.includes("Refresh the product tax classification")));
  assert.ok(steps.some((step) => step.includes("will not auto-resume")));
});

test("quarantine recovery surface is read-only and has no commerce/procurement mutation authority", async () => {
  const source = await readFile("src/components/commerce-quarantine-queue.tsx", "utf8");
  assert.match(source, /commerceEnabled === false/);
  assert.match(source, /read-only/);
  assert.doesNotMatch(source, /data:\s*\{[^}]*commerceEnabled:\s*true/s);
  assert.doesNotMatch(source, /prisma\.product\.(update|updateMany|upsert|create|delete)/);
  assert.doesNotMatch(source, /procurementIntent\.(update|updateMany|upsert|create|delete)/);
});

test("owner Product Engine page renders the quarantine recovery queue", async () => {
  const source = await readFile("src/app/admin/product-engine/page.tsx", "utf8");
  assert.match(source, /CommerceQuarantineQueue/);
  assert.match(source, /<CommerceQuarantineQueue \/>/);
});
