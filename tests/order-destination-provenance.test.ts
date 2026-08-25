import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("checkout delegates shipping collection to Stripe and browser checkout has no address fields", async () => {
  const checkoutSource = await readFile("src/app/api/checkout/route.ts", "utf8");
  const stripeSource = await readFile("src/lib/stripe-commerce.ts", "utf8");

  assert.doesNotMatch(checkoutSource, /shippingAddress|shipping_address|postalCode|postal_code|line1/);
  assert.match(stripeSource, /shipping_address_collection\[allowed_countries\]\[\]/);
  assert.match(stripeSource, /CHECKOUT_SHIPPING_COUNTRIES_NOT_CONFIGURED/);
});

test("webhook persists Checkout destination before procurement and PaymentIntent alone cannot release it", async () => {
  const webhookSource = await readFile("src/app/api/stripe/webhook/route.ts", "utf8");

  const completedStart = webhookSource.indexOf('case "checkout.session.completed":');
  const asyncStart = webhookSource.indexOf('case "checkout.session.async_payment_succeeded":');
  const intentStart = webhookSource.indexOf('case "payment_intent.succeeded":');
  const failureStart = webhookSource.indexOf('case "checkout.session.async_payment_failed":');

  assert.ok(completedStart >= 0 && asyncStart > completedStart && intentStart > asyncStart && failureStart > intentStart);

  const completedBlock = webhookSource.slice(completedStart, asyncStart);
  const asyncBlock = webhookSource.slice(asyncStart, intentStart);
  const intentBlock = webhookSource.slice(intentStart, failureStart);

  assert.ok(completedBlock.indexOf("persistCheckoutOrderDestination") < completedBlock.indexOf("ensureProcurementIntentsForPaidOrder"));
  assert.ok(asyncBlock.indexOf("persistCheckoutOrderDestination") < asyncBlock.indexOf("ensureProcurementIntentsForPaidOrder"));
  assert.match(intentBlock, /markPaymentSucceeded/);
  assert.doesNotMatch(intentBlock, /ensureProcurementIntentsForPaidOrder/);
});

test("procurement requires a Stripe Checkout-derived destination bound to the same session", async () => {
  const source = await readFile("src/lib/procurement-intents.ts", "utf8");

  assert.match(source, /PROCUREMENT_REQUIRES_VERIFIED_ORDER_DESTINATION/);
  assert.match(source, /destination\.source !== ORDER_DESTINATION_SOURCE/);
  assert.match(source, /destination\.stripeCheckoutSessionId !== order\.stripeCheckoutSessionId/);
  assert.match(source, /PAYMENT_AND_DESTINATION_VERIFIED_PROCUREMENT_INTENT_CREATED/);
});
