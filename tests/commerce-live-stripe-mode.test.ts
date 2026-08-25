import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BROAD_CATALOG_COMMERCE_LOCKED,
  evaluateBroadCatalogCommerceActivation,
} from "../src/lib/commerce-switch";

test("production broad commerce cannot activate while the emergency lock remains engaged", () => {
  assert.equal(BROAD_CATALOG_COMMERCE_LOCKED, true);
  assert.equal(
    evaluateBroadCatalogCommerceActivation({
      locked: true,
      commerceEnabled: true,
      production: true,
      stripeLivemode: true,
      stripeAutomaticTaxEnabled: true,
      taxComplianceCertified: true,
    }),
    false,
  );
});

test("future production activation requires Stripe live mode exactly", () => {
  assert.equal(
    evaluateBroadCatalogCommerceActivation({
      locked: false,
      commerceEnabled: true,
      production: true,
      stripeLivemode: true,
      stripeAutomaticTaxEnabled: true,
      taxComplianceCertified: true,
    }),
    true,
  );
  assert.equal(
    evaluateBroadCatalogCommerceActivation({
      locked: false,
      commerceEnabled: true,
      production: true,
      stripeLivemode: false,
      stripeAutomaticTaxEnabled: true,
      taxComplianceCertified: true,
    }),
    false,
  );
  assert.equal(
    evaluateBroadCatalogCommerceActivation({
      locked: false,
      commerceEnabled: true,
      production: true,
      stripeLivemode: null,
      stripeAutomaticTaxEnabled: true,
      taxComplianceCertified: true,
    }),
    false,
  );
});

test("future production activation fails closed unless tax readiness is explicitly certified", () => {
  assert.equal(
    evaluateBroadCatalogCommerceActivation({
      locked: false,
      commerceEnabled: true,
      production: true,
      stripeLivemode: true,
      stripeAutomaticTaxEnabled: false,
      taxComplianceCertified: true,
    }),
    false,
  );
  assert.equal(
    evaluateBroadCatalogCommerceActivation({
      locked: false,
      commerceEnabled: true,
      production: true,
      stripeLivemode: true,
      stripeAutomaticTaxEnabled: true,
      taxComplianceCertified: false,
    }),
    false,
  );
  assert.equal(
    evaluateBroadCatalogCommerceActivation({
      locked: false,
      commerceEnabled: true,
      production: true,
      stripeLivemode: true,
      stripeAutomaticTaxEnabled: false,
      taxComplianceCertified: false,
    }),
    false,
  );
});

test("non-production commerce may use test Stripe while production tax readiness remains strict", () => {
  assert.equal(
    evaluateBroadCatalogCommerceActivation({
      locked: false,
      commerceEnabled: true,
      production: false,
      stripeLivemode: false,
      stripeAutomaticTaxEnabled: false,
      taxComplianceCertified: false,
    }),
    true,
  );
  assert.equal(
    evaluateBroadCatalogCommerceActivation({
      locked: false,
      commerceEnabled: false,
      production: false,
      stripeLivemode: false,
      stripeAutomaticTaxEnabled: false,
      taxComplianceCertified: false,
    }),
    false,
  );
});

test("production mode proof uses authoritative Stripe mode and explicit tax interlocks", async () => {
  const switchSource = await readFile("src/lib/commerce-switch.ts", "utf8");
  const stripeSource = await readFile("src/lib/stripe-commerce.ts", "utf8");
  const gateSource = await readFile("src/lib/commerce-gate.ts", "utf8");
  const checkoutSource = await readFile("src/app/api/checkout/route.ts", "utf8");

  assert.match(switchSource, /expectedStripeLivemode/);
  assert.match(switchSource, /stripeLivemode !== true/);
  assert.match(switchSource, /STRIPE_AUTOMATIC_TAX_ENABLED/);
  assert.match(switchSource, /TAX_COMPLIANCE_CERTIFIED/);
  assert.match(switchSource, /!input\.stripeAutomaticTaxEnabled \|\| !input\.taxComplianceCertified/);
  assert.match(stripeSource, /getCloudflareContext\(\)\.env/);
  assert.match(stripeSource, /if \(secretKey\.startsWith\("sk_live_"\)\) return true/);
  assert.match(stripeSource, /if \(secretKey\.startsWith\("sk_test_"\)\) return false/);
  assert.match(gateSource, /isBroadCatalogCommerceEnabled\(\)/);
  assert.match(checkoutSource, /evaluateCommerceGate\(input\)/);
});

test("certification remains an independently scoped Stripe test-mode bypass", async () => {
  const checkoutSource = await readFile("src/app/api/checkout/route.ts", "utf8");
  assert.match(checkoutSource, /certificationBypass = certificationOnly && isStripeTestMode\(\)/);
  assert.match(checkoutSource, /CERTIFICATION_REQUIRES_TEST_MODE/);
  assert.match(checkoutSource, /evaluateCertificationCommerceGate\(input\)/);
});
