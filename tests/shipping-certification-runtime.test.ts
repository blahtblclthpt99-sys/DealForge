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

test("shipping verifier uses DealForge's adapter-aware database factory", async () => {
  const source = await readFile("scripts/verify-shipping-certification.ts", "utf8");
  assert.match(source, /import \{ getPrisma \} from "\.\.\/src\/lib\/db"/);
  assert.match(source, /const prisma = getPrisma\(\)/);
  assert.doesNotMatch(source, /new PrismaClient\(/);
});

test("hosted shipping certification requires Stripe Checkout to actually complete", async () => {
  const source = await readFile("scripts/complete-hosted-shipping-checkout.ts", "utf8");
  assert.match(source, /SHIPPING_CERT_CHECKOUT_DID_NOT_COMPLETE/);
  assert.ok(!source.includes('await page.waitForURL(url => !url.hostname.endsWith("stripe.com"), { timeout: 90_000 }).catch(() => undefined);'));
  assert.match(source, /try \{\s*await page\.waitForURL\(url => !isStripeCheckoutHost\(url\.hostname\), \{ timeout: 90_000 \}\);\s*\} catch \{/);
  assert.match(source, /if \(isStripeCheckoutHost\(finalUrl\.hostname\)\)/);
  assert.match(source, /Hosted shipping checkout completed/);
});

test("hosted shipping certification opts out of optional Link enrollment", async () => {
  const source = await readFile("scripts/complete-hosted-shipping-checkout.ts", "utf8");
  assert.match(source, /save my information for faster checkout/i);
  assert.match(source, /optOutOfOptionalLinkEnrollment\(page\)/);
  assert.match(source, /\.uncheck\(\{ force: true \}\)/);
  assert.match(source, /SHIPPING_CERT_LINK_OPT_OUT_FAILED/);
  assert.match(source, /dismissAddressAutocomplete\(page\)/);
  assert.match(source, /page\.keyboard\.press\("Escape"\)/);

  const optOut = source.indexOf("await optOutOfOptionalLinkEnrollment(page)");
  const submit = source.indexOf("await submit.click()");
  assert.ok(optOut >= 0 && submit > optOut, "Link opt-out must occur before payment submission");
});
