import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transform } from "esbuild";

for (const path of [
  "scripts/complete-hosted-shipping-checkout.ts",
  "scripts/verify-shipping-certification.ts",
]) {
  test(`${path} is executable through tsx CommonJS transform`, async () => {
    const source = await readFile(path, "utf8");
    const result = await transform(source, {
      loader: "ts",
      format: "cjs",
      target: "node24",
      sourcemap: false,
    });
    assert.ok(result.code.includes("main"));
  });
}

test("hosted shipping certification requires Stripe Checkout to actually complete", async () => {
  const source = await readFile("scripts/complete-hosted-shipping-checkout.ts", "utf8");
  assert.match(source, /SHIPPING_CERT_CHECKOUT_DID_NOT_COMPLETE/);
  assert.doesNotMatch(source, /waitForURL\([\s\S]*?\.catch\(\(\) => undefined\)/);
  assert.match(source, /if \(isStripeCheckoutHost\(finalUrl\.hostname\)\)/);
  assert.match(source, /Hosted shipping checkout completed/);
});
