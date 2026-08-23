import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/admin/commerce/opportunities/route.ts", "utf8");

test("opportunity queue is owner-only, no-store, and advisory", () => {
  assert.match(route, /isProductOwner/);
  assert.match(route, /private, no-store, max-age=0/);
  assert.match(route, /advisoryOnly:\s*true/);
  assert.match(route, /automaticActivationEnabled:\s*false/);
  assert.match(route, /demandSignalsAffectRanking:\s*false/);
});

test("opportunity queue cannot activate products or perform financial/provider actions", () => {
  assert.doesNotMatch(route, /prisma\.product\.(?:create|update|updateMany|delete|deleteMany|upsert)/);
  assert.doesNotMatch(route, /prisma\.order\.(?:create|update|updateMany|delete|deleteMany|upsert)/);
  assert.doesNotMatch(route, /systemLog\.create/);
  assert.doesNotMatch(route, /commerceEnabled:\s*true/);
  assert.doesNotMatch(route, /stripe-commerce|api\.stripe\.com|createStripe|refund/i);
});
