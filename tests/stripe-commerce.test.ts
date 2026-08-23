import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  assertPositiveCents,
  createStripeCheckoutSession,
  expireStripeCheckoutSession,
  payloadSha256,
  retrieveStripeCheckoutSession,
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

test("Checkout disables Managed Payments and uses immutable Stripe Prices", async () => {
  const previousSecretKey = process.env.STRIPE_SECRET_KEY;
  const previousFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: URLSearchParams }> = [];

  process.env.STRIPE_SECRET_KEY = "sk_test_dealforge_unit";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = init?.body instanceof URLSearchParams
      ? new URLSearchParams(init.body)
      : new URLSearchParams(typeof init?.body === "string" ? init.body : "");
    requests.push({ url, body });

    if (url.endsWith("/prices")) {
      return new Response(JSON.stringify({ id: "price_unit_checkout" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/checkout/sessions")) {
      return new Response(JSON.stringify({ id: "cs_unit_checkout", url: "https://checkout.stripe.com/c/pay/cs_unit_checkout" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected Stripe URL: ${url}`);
  }) as typeof fetch;

  try {
    const session = await createStripeCheckoutSession({
      orderId: "order_unit_1",
      orderNumber: "DF-UNIT-1",
      customerEmail: "buyer@example.com",
      currency: "usd",
      lines: [{ name: "Unit test item", unitAmountCents: 500, quantity: 1 }],
      successUrl: "https://www.deal-forge.sale/checkout/success",
      cancelUrl: "https://www.deal-forge.sale/checkout/cancel",
    });

    assert.equal(session.id, "cs_unit_checkout");
    const checkoutRequest = requests.find((request) => request.url.endsWith("/checkout/sessions"));
    assert.ok(checkoutRequest);
    assert.equal(checkoutRequest.body.get("managed_payments[enabled]"), "false");
    assert.equal(checkoutRequest.body.get("line_items[0][price]"), "price_unit_checkout");
    assert.equal(checkoutRequest.body.get("line_items[0][quantity]"), "1");
    assert.equal(checkoutRequest.body.get("mode"), "payment");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousSecretKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousSecretKey;
  }
});

test("Checkout resume retrieves the exact Stripe session server-side", async () => {
  const previousSecretKey = process.env.STRIPE_SECRET_KEY;
  const previousFetch = globalThis.fetch;
  process.env.STRIPE_SECRET_KEY = "sk_test_dealforge_resume";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assert.equal(url, "https://api.stripe.com/v1/checkout/sessions/cs_test_resume_123");
    assert.equal(init?.method, "GET");
    return new Response(JSON.stringify({
      id: "cs_test_resume_123",
      url: "https://checkout.stripe.com/c/pay/cs_test_resume_123",
      status: "open",
      payment_status: "unpaid",
      client_reference_id: "order_resume_1",
      metadata: { order_id: "order_resume_1", order_number: "DF-RESUME-1" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const session = await retrieveStripeCheckoutSession("cs_test_resume_123");
    assert.equal(session.id, "cs_test_resume_123");
    assert.equal(session.status, "open");
    assert.equal(session.payment_status, "unpaid");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousSecretKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousSecretKey;
  }
});

test("Checkout revocation expires the exact Stripe session with an idempotency key", async () => {
  const previousSecretKey = process.env.STRIPE_SECRET_KEY;
  const previousFetch = globalThis.fetch;
  process.env.STRIPE_SECRET_KEY = "sk_test_dealforge_expire";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assert.equal(url, "https://api.stripe.com/v1/checkout/sessions/cs_test_expire_123/expire");
    assert.equal(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assert.match(headers.get("idempotency-key") || "", /^dealforge-expire:[a-f0-9]{64}$/);
    return new Response(JSON.stringify({
      id: "cs_test_expire_123",
      url: null,
      status: "expired",
      payment_status: "unpaid",
      client_reference_id: "order_expire_1",
      metadata: { order_id: "order_expire_1", order_number: "DF-EXPIRE-1" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const session = await expireStripeCheckoutSession({
      checkoutSessionId: "cs_test_expire_123",
      orderId: "order_expire_1",
      reason: "PRODUCT_UNSAFE:SOURCE_STALE",
    });
    assert.equal(session.id, "cs_test_expire_123");
    assert.equal(session.status, "expired");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousSecretKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousSecretKey;
  }
});
