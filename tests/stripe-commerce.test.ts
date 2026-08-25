import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  assertCardOnlyCheckoutSession,
  assertPositiveCents,
  assertStripeEventMode,
  expectedStripeLivemode,
  isExactWebhookReplay,
  payloadSha256,
  resolveStripeRuntimeValue,
  stripeWebhookSecret,
  verifyStripeSignature,
} from "../src/lib/stripe-commerce";

function withStripeEnv(
  values: Record<string, string | undefined>,
  run: () => void,
) {
  const names = [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET_LIVE",
    "STRIPE_WEBHOOK_SECRET_TEST",
    "STRIPE_WEBHOOK_SECRET",
  ] as const;
  const before = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    for (const [name, value] of Object.entries(values)) {
      if (value !== undefined) process.env[name] = value;
    }
    run();
  } finally {
    for (const name of names) {
      const value = before.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

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

test("Stripe runtime values prefer exact Cloudflare bindings over process snapshots", () => {
  const processEnv = {
    STRIPE_SECRET_KEY: "sk_test_process",
    STRIPE_WEBHOOK_SECRET_TEST: "whsec_process",
  };
  const cloudflareEnv = {
    STRIPE_SECRET_KEY: "  sk_test_cloudflare  ",
    STRIPE_WEBHOOK_SECRET_TEST: "  whsec_cloudflare  ",
    ASSETS: { type: "assets" },
  };

  assert.equal(
    resolveStripeRuntimeValue("STRIPE_SECRET_KEY", processEnv, cloudflareEnv),
    "sk_test_cloudflare",
  );
  assert.equal(
    resolveStripeRuntimeValue("STRIPE_WEBHOOK_SECRET_TEST", processEnv, cloudflareEnv),
    "whsec_cloudflare",
  );
  assert.equal(
    resolveStripeRuntimeValue("STRIPE_WEBHOOK_SECRET_LIVE", processEnv, cloudflareEnv),
    "",
  );
});

test("Stripe runtime values fall back to process env outside Cloudflare", () => {
  const processEnv = {
    STRIPE_SECRET_KEY: "  sk_live_process  ",
  };
  assert.equal(
    resolveStripeRuntimeValue("STRIPE_SECRET_KEY", processEnv, null),
    "sk_live_process",
  );
});

test("Stripe mode is derived from the configured secret key", () => {
  assert.equal(expectedStripeLivemode("sk_live_example"), true);
  assert.equal(expectedStripeLivemode("sk_test_example"), false);
});

test("Stripe webhook mode falls back to a single test signing secret when API key is absent", () => {
  withStripeEnv(
    {
      STRIPE_WEBHOOK_SECRET_TEST: "whsec_test_runtime",
    },
    () => {
      assert.equal(expectedStripeLivemode(""), false);
      assert.equal(stripeWebhookSecret(), "whsec_test_runtime");
    },
  );
});

test("Stripe webhook mode falls back to a single live signing secret when API key is absent", () => {
  withStripeEnv(
    {
      STRIPE_WEBHOOK_SECRET_LIVE: "whsec_live_runtime",
    },
    () => {
      assert.equal(expectedStripeLivemode(""), true);
      assert.equal(stripeWebhookSecret(), "whsec_live_runtime");
    },
  );
});

test("Stripe webhook mode fails closed when live and test secrets are both present without API-key mode", () => {
  withStripeEnv(
    {
      STRIPE_WEBHOOK_SECRET_LIVE: "whsec_live_runtime",
      STRIPE_WEBHOOK_SECRET_TEST: "whsec_test_runtime",
    },
    () => {
      assert.throws(() => expectedStripeLivemode(""), /STRIPE_WEBHOOK_MODE_AMBIGUOUS/);
      assert.throws(() => stripeWebhookSecret(), /STRIPE_WEBHOOK_MODE_AMBIGUOUS/);
    },
  );
});

test("Stripe mode remains unknown when neither API-key mode nor mode-specific webhook secret exists", () => {
  withStripeEnv({}, () => {
    assert.throws(() => expectedStripeLivemode(""), /STRIPE_SECRET_KEY_MODE_UNKNOWN/);
  });
});

test("Stripe webhook event mode must be explicit and match the configured environment", () => {
  assert.doesNotThrow(() => assertStripeEventMode({ livemode: true }, true));
  assert.doesNotThrow(() => assertStripeEventMode({ livemode: false }, false));
  assert.throws(() => assertStripeEventMode({ livemode: false }, true), /STRIPE_EVENT_MODE_MISMATCH/);
  assert.throws(() => assertStripeEventMode({}, false), /STRIPE_EVENT_LIVEMODE_MISSING/);
});

test("card-only certification rejects any Stripe session that exposes another method", () => {
  assert.doesNotThrow(() => assertCardOnlyCheckoutSession({ payment_method_types: ["card"] }));
  assert.throws(
    () => assertCardOnlyCheckoutSession({ payment_method_types: ["card", "link"] }),
    /STRIPE_CARD_ONLY_SESSION_NOT_ENFORCED/,
  );
  assert.throws(
    () => assertCardOnlyCheckoutSession({}),
    /STRIPE_CARD_ONLY_SESSION_NOT_ENFORCED/,
  );
});

test("money helper only accepts positive safe integer cents", () => {
  assert.doesNotThrow(() => assertPositiveCents(1, "amount"));
  assert.doesNotThrow(() => assertPositiveCents(999_999, "amount"));
  assert.throws(() => assertPositiveCents(0, "amount"), /AMOUNT_INVALID/);
  assert.throws(() => assertPositiveCents(-1, "amount"), /AMOUNT_INVALID/);
  assert.throws(() => assertPositiveCents(1.5, "amount"), /AMOUNT_INVALID/);
  assert.throws(() => assertPositiveCents(Number.MAX_SAFE_INTEGER + 1, "amount"), /AMOUNT_INVALID/);
});
