import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

type WranglerConfig = {
  vars?: Record<string, unknown>;
  secrets?: { required?: unknown[] };
};

async function readWranglerConfig() {
  return JSON.parse(await readFile("wrangler.jsonc", "utf8")) as WranglerConfig;
}

test("Cloudflare production runtime provisions the narrow shipping-country scope", async () => {
  const config = await readWranglerConfig();

  assert.equal(config.vars?.CHECKOUT_ALLOWED_SHIPPING_COUNTRIES, "US");
});

test("shipping-country scope is a non-secret Worker variable", async () => {
  const config = await readWranglerConfig();
  const requiredSecrets = config.secrets?.required ?? [];

  assert.equal(typeof config.vars?.CHECKOUT_ALLOWED_SHIPPING_COUNTRIES, "string");
  assert.equal(requiredSecrets.includes("CHECKOUT_ALLOWED_SHIPPING_COUNTRIES"), false);
});

test("hosted Stripe gate reruns when shipping runtime or destination code changes", async () => {
  const workflow = await readFile(".github/workflows/stripe-phase25-e2e-v6.yml", "utf8");

  for (const path of [
    "wrangler.jsonc",
    "prisma/schema.postgres.prisma",
    "src/lib/checkout-shipping.ts",
    "src/lib/order-destination.ts",
    "tests/cloudflare-shipping-runtime-contract.test.ts",
    "tests/order-destination.test.ts",
    "tests/order-destination-provenance.test.ts",
  ]) {
    assert.match(workflow, new RegExp(`- '${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
  }
});
