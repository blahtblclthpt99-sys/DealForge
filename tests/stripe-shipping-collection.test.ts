import assert from "node:assert/strict";
import test from "node:test";
import { appendStripeShippingAddressCollection } from "../src/lib/stripe-commerce";

test("Stripe Checkout shipping collection emits normalized unique allowed countries", () => {
  const body = new URLSearchParams();
  appendStripeShippingAddressCollection(body, ["us", "CA", "US"]);
  assert.deepEqual(
    body.getAll("shipping_address_collection[allowed_countries][]"),
    ["US", "CA"],
  );
});

test("Stripe Checkout shipping collection fails closed without a destination scope", () => {
  const body = new URLSearchParams();
  assert.throws(
    () => appendStripeShippingAddressCollection(body, []),
    /CHECKOUT_SHIPPING_COUNTRIES_NOT_CONFIGURED/,
  );
  assert.throws(
    () => appendStripeShippingAddressCollection(body, ["USA"]),
    /CHECKOUT_SHIPPING_COUNTRY_INVALID/,
  );
});
