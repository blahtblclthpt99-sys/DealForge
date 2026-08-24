import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("admin API uses current database-backed authorization and validated patch shapes", async () => {
  const source = await readFile("src/app/api/admin/route.ts", "utf8");

  assert.match(source, /requireAdmin/);
  assert.doesNotMatch(source, /readSession/);
  assert.match(source, /z\.discriminatedUnion\("type"/);
  assert.match(source, /z\.enum\(\["user", "admin"\]\)/);
  assert.match(source, /INVALID_ADMIN_UPDATE/);
  assert.match(source, /price: z\.number\(\)\.finite\(\)\.min\(0\)/);
});

test("admin provider responses do not expose stored API credentials", async () => {
  const source = await readFile("src/app/api/admin/route.ts", "utf8");

  assert.doesNotMatch(source, /apiCredentials/);
  assert.match(source, /prisma\.affiliateProvider\.findMany/);
  assert.match(source, /trackingId: true/);
  assert.match(source, /enabled: true/);
});

test("admin mutations return minimized response projections", async () => {
  const source = await readFile("src/app/api/admin/route.ts", "utf8");

  assert.match(source, /select: \{ id: true, email: true, role: true \}/);
  assert.match(source, /isFeatured: true/);
  assert.match(source, /isFlashDeal: true/);
});
