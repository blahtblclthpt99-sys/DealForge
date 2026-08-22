import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  assertPositiveCents,
  payloadSha256,
  verifyStripeSignature,
} from "../src/lib/stripe-commerce";

test("Stripe webhook signature accepts the exact signed payload", () => {
  const secret = "whsec_test_secret";
  const timestamp = 1_800_000_000;
  const body = JSON.stringify({ id: "evt_test", type: "payment_intent.succeeded" });
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");

  assert.equal(
    verifyStripeSignature(body, `t=${timestamp},v1=${signature}`, secret, {
      nowSeconds: timestamp,
    }),
    true,
  );
});

test("Stripe webhook signature rejects tampered payloads", () => {
  const secret = "whsec_test_secret";
  const timestamp = 1_800_000_000;
  const body = "original";
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");

  assert.equal(
    verifyStripeSignature("tampered", `t=${timestamp},v1=${signature}`, secret, {
      nowSeconds: timestamp,
    }),
    false,
  );
});

test("Stripe webhook signature rejects replay outside tolerance", () => {
  const secret = "whsec_test_secret";
  const timestamp = 1_800_000_000;
  const body = "payload";
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");

  assert.equal(
    verifyStripeSignature(body, `t=${timestamp},v1=${signature}`, secret, {
      nowSeconds: timestamp + 301,
      toleranceSeconds: 300,
    }),
    false,
  );
});

test("webhook payload hash is deterministic and payload-sensitive", () => {
  assert.equal(payloadSha256("same"), payloadSha256("same"));
  assert.notEqual(payloadSha256("same"), payloadSha256("different"));
});

test("money helper only accepts positive safe integer cents", () => {
  assert.doesNotThrow(() => assertPositiveCents(1, "amount"));
  assert.doesNotThrow(() => assertPositiveCents(999_999, "amount"));
  assert.throws(() => assertPositiveCents(0, "amount"), /AMOUNT_INVALID/);
  assert.throws(() => assertPositiveCents(-1, "amount"), /AMOUNT_INVALID/);
  assert.throws(() => assertPositiveCents(1.5, "amount"), /AMOUNT_INVALID/);
  assert.throws(() => assertPositiveCents(Number.MAX_SAFE_INTEGER + 1, "amount"), /AMOUNT_INVALID/);
});
