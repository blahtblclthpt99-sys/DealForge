import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Cloudflare production runtime provisions the narrow shipping-country scope", async () => {
  const source = await readFile("wrangler.jsonc", "utf8");

  assert.match(source, /"CHECKOUT_ALLOWED_SHIPPING_COUNTRIES"\s*:\s*"US"/);
  assert.doesNotMatch(source, /"CHECKOUT_ALLOWED_SHIPPING_COUNTRIES"\s*:\s*"\s*"/);
});

test("shipping-country scope is a non-secret Worker variable", async () => {
  const source = await readFile("wrangler.jsonc", "utf8");
  const varsStart = source.indexOf('"vars"');
  const secretStart = source.indexOf('"secrets"');
  const countryStart = source.indexOf('"CHECKOUT_ALLOWED_SHIPPING_COUNTRIES"');

  assert.ok(varsStart >= 0 && countryStart > varsStart);
  assert.ok(secretStart >= 0 && countryStart > secretStart);
});
