import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/admin/commerce/profitability/route.ts", "utf8");

test("profitability API remains owner-only and no-store", () => {
  assert.match(route, /isProductOwner/);
  assert.match(route, /private, no-store, max-age=0/);
  assert.match(route, /Referrer-Policy/);
  assert.match(route, /REALIZED_CONTRIBUTION_BEFORE_PROCESSOR_FEES_AND_OVERHEAD/);
});

test("profitability API is read-only and does not call payment providers", () => {
  assert.doesNotMatch(route, /prisma\.order\.(?:create|update|updateMany|delete|deleteMany|upsert)/);
  assert.doesNotMatch(route, /prisma\.product\.(?:create|update|updateMany|delete|deleteMany|upsert)/);
  assert.doesNotMatch(route, /prisma\.refund\.(?:create|update|updateMany|delete|deleteMany|upsert)/);
  assert.doesNotMatch(route, /systemLog\.create/);
  assert.doesNotMatch(route, /stripe-commerce|api\.stripe\.com|createStripe|refundPayment|PostRefund/i);
});

test("profitability API does not project customer email or supplier references", () => {
  assert.doesNotMatch(route, /email:\s*order\.email/);
  assert.doesNotMatch(route, /supplierOrderReference/);
  assert.doesNotMatch(route, /performedByUserId/);
  assert.doesNotMatch(route, /savedByUserId/);
});
