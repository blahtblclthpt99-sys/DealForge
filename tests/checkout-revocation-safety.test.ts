import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(path: string) {
  return fs.readFileSync(path, "utf8");
}

test("initial checkout enforces exposure before order or Stripe session creation", () => {
  const checkout = source("src/app/api/checkout/route.ts");
  const exposure = checkout.indexOf("const exposure = checkCheckoutExposure(");
  const orderCreate = checkout.indexOf('stage = "order_create"');
  const stripeCreate = checkout.indexOf("const stripeSession = await createStripeCheckoutSession(");
  assert.ok(exposure >= 0 && orderCreate >= 0 && stripeCreate >= 0);
  assert.ok(exposure < orderCreate);
  assert.ok(orderCreate < stripeCreate);
  assert.match(checkout, /error: "CHECKOUT_LIMIT_EXCEEDED"/);
  assert.doesNotMatch(checkout, /supplierExposureCents[^\n]*NextResponse/);
});

test("resume verifies Stripe identity and paid state before expiring an unsafe session", () => {
  const resume = source("src/app/api/checkout/resume/route.ts");
  const retrieve = resume.indexOf("const session = await retrieveStripeCheckoutSession(");
  const identity = resume.indexOf("if (!sessionMatchesOrder(session, order))");
  const paid = resume.indexOf('if (session.payment_status === "paid" || session.status === "complete")');
  const unsafe = resume.indexOf("if (!checkoutSafety.safe)");
  const expire = resume.indexOf("await expireStripeCheckoutSession({");
  assert.ok([retrieve, identity, paid, unsafe, expire].every((index) => index >= 0));
  assert.ok(retrieve < identity && identity < paid && paid < unsafe && unsafe < expire);
  assert.match(resume, /CHECKOUT_REVALIDATION_REQUIRED/);
  assert.match(resume, /const latest = await retrieveStripeCheckoutSession/);
});

test("scheduled checkout safety is scoped to unpaid states and cannot move money", () => {
  const worker = source("src/workers/checkout-safety.ts");
  assert.match(worker, /status: \{ in: \["pending_payment", "payment_failed"\] \}/);
  assert.match(worker, /checkPendingCheckoutSafety/);
  assert.match(worker, /retrieveStripeCheckoutSession/);
  assert.match(worker, /expireStripeCheckoutSession/);
  assert.doesNotMatch(worker, /createStripeRefund/);
  assert.doesNotMatch(worker, /createStripeCheckoutSession/);
  assert.doesNotMatch(worker, /prisma\.order\.(?:update|updateMany|create|delete)/);
  assert.doesNotMatch(worker, /prisma\.product\.(?:update|updateMany|create|delete)/);
});

test("maintenance quarantines products before revoking unsafe unpaid sessions", () => {
  const maintenance = source("src/app/api/internal/maintenance/route.ts");
  const quarantine = maintenance.indexOf("await quarantineUnsafeDirectCommerce(500)");
  const revoke = maintenance.indexOf("await revokeUnsafePendingCheckouts(100)");
  const monitor = maintenance.indexOf("await monitorOrderOperations(200)");
  assert.ok(quarantine >= 0 && revoke >= 0 && monitor >= 0);
  assert.ok(quarantine < revoke && revoke < monitor);
  // Preserve the established CI source-of-truth guard from the previous slice.
  assert.match(maintenance, /commerceSafety, ownerQueue/);
});
