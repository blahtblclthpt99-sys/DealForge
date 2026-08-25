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
