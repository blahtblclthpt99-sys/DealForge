import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  assertPositiveCents,
  assertStripeEventMode,
  expectedStripeLivemode,
  isExactWebhookReplay,
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

test("Stripe webhook signature accepts any matching v1 during secret rotation", () => {
  const secret = "whsec_test_secret";
  const timestamp = 1_800_000_000;
  const body = "payload";
  const valid = createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
  assert.equal(
    verifyStripeSignature(body, `t=${timestamp},v1=${"0".repeat(64)},v1=${valid}`, secret, {
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

test("Stripe webhook signature accepts the exact tolerance boundary", () => {
  const secret = "whsec_test_secret";
  const timestamp = 1_800_000_000;
  const body = "payload";
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");

  assert.equal(
    verifyStripeSignature(body, `t=${timestamp},v1=${signature}`, secret, {
      nowSeconds: timestamp + 300,
      toleranceSeconds: 300,
    }),
    true,
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

test("Stripe webhook signature rejects invalid timestamps and tolerance", () => {
  const secret = "whsec_test_secret";
  assert.equal(verifyStripeSignature("x", "t=0,v1=aa", secret, { nowSeconds: 0 }), false);
  assert.equal(
    verifyStripeSignature("x", "t=1800000000,v1=aa", secret, {
      nowSeconds: 1_800_000_000,
      toleranceSeconds: -1,
    }),
    false,
  );
});

test("webhook payload hash is deterministic and payload-sensitive", () => {
  assert.equal(payloadSha256("same"), payloadSha256("same"));
  assert.notEqual(payloadSha256("same"), payloadSha256("different"));
});

test("exact webhook replay requires the identical raw payload", () => {
  const original = JSON.stringify({ id: "evt_123", type: "payment_intent.succeeded", data: { object: {} } });
  const hash = payloadSha256(original);
  assert.equal(isExactWebhookReplay(hash, original), true);
  assert.equal(isExactWebhookReplay(hash, `${original} `), false);
  assert.equal(isExactWebhookReplay("not-a-hash", original), false);
});

test("Stripe mode is derived from the configured secret key", () => {
  assert.equal(expectedStripeLivemode("sk_live_example"), true);
  assert.equal(expectedStripeLivemode("sk_test_example"), false);
  assert.throws(() => expectedStripeLivemode("rk_live_example"), /STRIPE_SECRET_KEY_MODE_UNKNOWN/);
  assert.throws(() => expectedStripeLivemode(""), /STRIPE_SECRET_KEY_MODE_UNKNOWN/);
});

test("Stripe webhook event mode must be explicit and match the configured environment", () => {
  assert.doesNotThrow(() => assertStripeEventMode({ livemode: true }, true));
  assert.doesNotThrow(() => assertStripeEventMode({ livemode: false }, false));
  assert.throws(() => assertStripeEventMode({ livemode: false }, true), /STRIPE_EVENT_MODE_MISMATCH/);
  assert.throws(() => assertStripeEventMode({}, false), /STRIPE_EVENT_LIVEMODE_MISSING/);
});

test("money helper only accepts positive safe integer cents", () => {
  assert.doesNotThrow(() => assertPositiveCents(1, "amount"));
  assert.doesNotThrow(() => assertPositiveCents(999_999, "amount"));
  assert.throws(() => assertPositiveCents(0, "amount"), /AMOUNT_INVALID/);
  assert.throws(() => assertPositiveCents(-1, "amount"), /AMOUNT_INVALID/);
  assert.throws(() => assertPositiveCents(1.5, "amount"), /AMOUNT_INVALID/);
  assert.throws(() => assertPositiveCents(Number.MAX_SAFE_INTEGER + 1, "amount"), /AMOUNT_INVALID/);
});
