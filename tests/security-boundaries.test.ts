import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveAuthSecret } from "../src/lib/auth-secret";
import { normalizeExternalHttpUrl, resolvePublicAppOrigin } from "../src/lib/url-security";

test("production session signing fails closed without a strong AUTH_SECRET", () => {
  assert.throws(
    () => resolveAuthSecret({ NODE_ENV: "production" }),
    /AUTH_SECRET_MISSING/,
  );
  assert.throws(
    () => resolveAuthSecret({ NODE_ENV: "production", AUTH_SECRET: "too-short" }),
    /AUTH_SECRET_TOO_SHORT/,
  );
  assert.throws(
    () =>
      resolveAuthSecret({
        NODE_ENV: "production",
        AUTH_SECRET: "change-me-to-a-long-random-string",
      }),
    /AUTH_SECRET_INSECURE_PLACEHOLDER/,
  );
});

test("production session signing accepts a sufficiently strong configured secret", () => {
  const secret = "8vF9pQ2sLm7xR4cN1zK6wT3yH5jD0bUaE9gS2mV7";
  assert.equal(
    resolveAuthSecret({ NODE_ENV: "production", AUTH_SECRET: secret }),
    secret,
  );
});

test("development keeps a non-production fallback without exposing it through auth.ts", async () => {
  assert.match(resolveAuthSecret({ NODE_ENV: "development" }), /development-only/);
  const auth = await readFile("src/lib/auth.ts", "utf8");
  assert.doesNotMatch(auth, /dev-insecure-secret/);
  assert.match(auth, /resolveAuthSecret/);
});

test("admin authorization re-checks the current database role", async () => {
  const auth = await readFile("src/lib/auth.ts", "utf8");
  assert.match(auth, /const current = await prisma\.user\.findUnique/);
  assert.match(auth, /current\.role !== "admin"/);
  assert.match(auth, /current\.email\.toLowerCase\(\) !== session\.email\.toLowerCase\(\)/);
});

test("API limiter preserves Stripe webhook delivery and bounds in-memory state", async () => {
  const middleware = await readFile("src/middleware.ts", "utf8");
  assert.match(middleware, /STRIPE_WEBHOOK_PATH = "\/api\/stripe\/webhook"/);
  assert.match(middleware, /pathname === STRIPE_WEBHOOK_PATH/);
  assert.match(middleware, /cf-connecting-ip/);
  assert.match(middleware, /MAX_TRACKED_KEYS = 10_000/);
  assert.match(middleware, /purgeExpired/);
  assert.match(middleware, /Retry-After/);
  assert.match(middleware, /AUTH_MAX = 30/);
  assert.match(middleware, /CHECKOUT_MAX = 60/);
});

test("production checkout return origin must be explicitly configured HTTPS", () => {
  assert.throws(
    () => resolvePublicAppOrigin("https://spoofed.example/checkout", { NODE_ENV: "production" }),
    /APP_URL_MISSING/,
  );
  assert.throws(
    () =>
      resolvePublicAppOrigin("https://spoofed.example/checkout", {
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "http://www.deal-forge.sale",
      }),
    /APP_URL_HTTPS_REQUIRED/,
  );
  assert.equal(
    resolvePublicAppOrigin("https://spoofed.example/checkout", {
      NODE_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://www.deal-forge.sale/",
    }),
    "https://www.deal-forge.sale",
  );
});

test("checkout origin configuration rejects paths, credentials, query strings and fragments", () => {
  for (const configured of [
    "https://deal-forge.sale/shop",
    "https://user:pass@deal-forge.sale",
    "https://deal-forge.sale/?next=evil",
    "https://deal-forge.sale/#fragment",
  ]) {
    assert.throws(() =>
      resolvePublicAppOrigin("http://localhost:3000/checkout", {
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: configured,
      }),
    );
  }
});

test("outbound retailer redirects allow only credential-free HTTP(S) URLs", () => {
  assert.equal(
    normalizeExternalHttpUrl("https://example.com/item?q=1"),
    "https://example.com/item?q=1",
  );
  assert.equal(normalizeExternalHttpUrl("javascript:alert(1)"), null);
  assert.equal(normalizeExternalHttpUrl("data:text/html,unsafe"), null);
  assert.equal(normalizeExternalHttpUrl("file:///tmp/unsafe"), null);
  assert.equal(normalizeExternalHttpUrl("https://user:pass@example.com/item"), null);
  assert.equal(normalizeExternalHttpUrl("not a url"), null);
});

test("checkout and outbound redirect routes use centralized URL trust guards", async () => {
  const checkout = await readFile("src/app/api/checkout/route.ts", "utf8");
  const outbound = await readFile("src/app/go/[productId]/route.ts", "utf8");
  assert.match(checkout, /resolvePublicAppOrigin\(request\.url\)/);
  assert.doesNotMatch(checkout, /return new URL\(request\.url\)\.origin/);
  assert.match(outbound, /normalizeExternalHttpUrl\(destination\)/);
  assert.match(outbound, /blocked_unsafe_destination/);
});
