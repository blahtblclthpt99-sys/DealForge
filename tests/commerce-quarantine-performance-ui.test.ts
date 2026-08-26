import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("quarantine performance intelligence remains read-only", async () => {
  const source = await readFile("src/components/commerce-quarantine-performance.tsx", "utf8");
  assert.match(source, /Quarantine performance intelligence/);
  assert.match(source, /latest 2,000 quarantine and resolution audit rows/);
  assert.match(source, /Supplier-level attribution is intentionally omitted/);
  assert.match(source, /never enables commerce, changes tax state, or authorizes procurement/);
  assert.doesNotMatch(source, /prisma\.product\.(update|updateMany|upsert|create|delete)/);
  assert.doesNotMatch(source, /prisma\.supplier(Offer)?\.(update|updateMany|upsert|create|delete)/);
  assert.doesNotMatch(source, /procurementIntent\.(create|update|updateMany|upsert|delete)/);
});
