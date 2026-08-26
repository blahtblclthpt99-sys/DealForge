import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const webhookRoute = readFileSync(join(root, "src/app/api/stripe/webhook/route.ts"), "utf8");
const checkoutRoute = readFileSync(join(root, "src/app/api/checkout/route.ts"), "utf8");
const procurementRoute = readFileSync(join(root, "src/app/api/admin/procurement/[id]/route.ts"), "utf8");
const shipmentRoute = readFileSync(join(root, "src/app/api/admin/procurement/[id]/shipment/route.ts"), "utf8");
const productionEnv = readFileSync(join(root, ".env.production.example"), "utf8");

test("authoritative Stripe webhook handles dispute lifecycle events", () => {
  for (const eventType of [
    "charge.dispute.created",
    "charge.dispute.updated",
    "charge.dispute.closed",
  ]) {
    assert.match(webhookRoute, new RegExp(`case \\"${eventType.replaceAll(".", "\\.")}\\"`));
  }
  assert.match(webhookRoute, /mergeStripeDisputeMeta/);
  assert.match(webhookRoute, /deriveFinancialOrderStatus/);
});

test("disputed orders cannot create a second checkout session with the same checkout key", () => {
  assert.match(checkoutRoute, /TERMINAL_CHECKOUT_STATUSES/);
  assert.match(checkoutRoute, /"payment_disputed"/);
  assert.match(checkoutRoute, /"payment_dispute_lost"/);
});

test("active dispute financial state remains a global procurement and shipment interlock", () => {
  assert.match(procurementRoute, /intent\.order\.status !== "paid"/);
  assert.match(procurementRoute, /current\.order\.status !== "paid"/);
  assert.match(shipmentRoute, /current\.order\.status !== "paid"/);
  assert.match(webhookRoute, /if \(financial\.status === "paid"\)/);
});

test("Stripe financial metadata writes use optimistic concurrency", () => {
  assert.match(webhookRoute, /WEBHOOK_FEE_CONCURRENT_PAYMENT_CHANGE/);
  assert.match(webhookRoute, /WEBHOOK_DISPUTE_CONCURRENT_PAYMENT_CHANGE/);
  assert.match(webhookRoute, /updatedAt: payment\.updatedAt/);
  assert.match(webhookRoute, /WEBHOOK_DISPUTE_CONCURRENT_ORDER_CHANGE/);
});

test("dispute hardening cannot silently release tax or autonomous procurement locks", () => {
  assert.match(productionEnv, /COMMERCE_ENABLED="false"/);
  assert.match(productionEnv, /STRIPE_AUTOMATIC_TAX_ENABLED="false"/);
  assert.match(productionEnv, /TAX_COMPLIANCE_CERTIFIED="false"/);
  assert.doesNotMatch(webhookRoute, /automaticSupplierPurchasingEnabled:\s*true/);
});
