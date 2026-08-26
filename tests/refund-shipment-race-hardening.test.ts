import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("shipment and delivery fail closed during refund activity", async () => {
  const source = await readFile("src/app/api/admin/procurement/[id]/shipment/route.ts", "utf8");
  assert.match(source, /hasActiveRefund\(current\.order\.refunds\)/);
  assert.match(source, /SHIPMENT_BLOCKED_BY_ACTIVE_REFUND/);
  assert.match(source, /POST_PURCHASE_REFUND_EXCEPTION_APPROVED/);
  assert.match(source, /SHIPMENT_BLOCKED_BY_POST_PURCHASE_REFUND_EXCEPTION/);
  assert.ok(source.indexOf("SHIPMENT_BLOCKED_BY_ACTIVE_REFUND") < source.indexOf("transitionProcurement(current.status"));
});

test("refund dispatch requires Stripe to echo exact authorized economics", async () => {
  const source = await readFile("src/app/api/admin/refunds/route.ts", "utf8");
  assert.match(source, /stripeRefund\.amount !== parsed\.data\.amountCents/);
  assert.match(source, /STRIPE_REFUND_AMOUNT_MISMATCH/);
  assert.match(source, /stripeRefund\.currency\.toLowerCase\(\) !== order\.currency\.toLowerCase\(\)/);
  assert.match(source, /STRIPE_REFUND_CURRENCY_MISMATCH/);
  assert.ok(source.indexOf("STRIPE_REFUND_AMOUNT_MISMATCH") < source.indexOf("prisma.refund.create"));
});
