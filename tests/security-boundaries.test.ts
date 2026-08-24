import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveAuthSecret } from "../src/lib/auth-secret";

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
