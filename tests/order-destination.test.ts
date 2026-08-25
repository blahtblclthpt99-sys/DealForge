import assert from "node:assert/strict";
import test from "node:test";
import {
  ORDER_DESTINATION_SOURCE,
  prepareCheckoutOrderDestination,
  sameOrderDestination,
} from "../src/lib/order-destination";

function checkoutSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_test_destination_123",
    collected_information: {
      shipping_details: {
        name: "Ada Buyer",
        address: {
          line1: "123 Main St",
          line2: "Unit 4",
          city: "Oklahoma City",
          state: "OK",
          postal_code: "73102",
          country: "us",
        },
      },
    },
    ...overrides,
  };
}

test("authoritative destination normalizes a Stripe Checkout shipping snapshot", () => {
  assert.deepEqual(prepareCheckoutOrderDestination(checkoutSession(), "US"), {
    stripeCheckoutSessionId: "cs_test_destination_123",
    name: "Ada Buyer",
    line1: "123 Main St",
    line2: "Unit 4",
    city: "Oklahoma City",
    state: "OK",
    postalCode: "73102",
    country: "US",
  });
});

test("authoritative destination fails closed outside configured shipping scope", () => {
  assert.throws(
    () => prepareCheckoutOrderDestination(checkoutSession(), "CA"),
    /ORDER_DESTINATION_COUNTRY_NOT_ALLOWED/,
  );
  assert.throws(
    () => prepareCheckoutOrderDestination(checkoutSession(), ""),
    /ORDER_DESTINATION_COUNTRIES_NOT_CONFIGURED/,
  );
});

test("US fulfillment destinations require state and a bound Checkout session id", () => {
  assert.throws(
    () =>
      prepareCheckoutOrderDestination(
        checkoutSession({
          collected_information: {
            shipping_details: {
              name: "Ada Buyer",
              address: {
                line1: "123 Main St",
                city: "Oklahoma City",
                postal_code: "73102",
                country: "US",
              },
            },
          },
        }),
        "US",
      ),
    /ORDER_DESTINATION_STATE_REQUIRED/,
  );

  assert.throws(
    () => prepareCheckoutOrderDestination(checkoutSession({ id: "not-a-checkout-session" }), "US"),
    /ORDER_DESTINATION_CHECKOUT_SESSION_INVALID/,
  );
});

test("persisted destination comparison is immutable across fulfillment fields", () => {
  const candidate = prepareCheckoutOrderDestination(checkoutSession(), "US");
  const persisted = { ...candidate, source: ORDER_DESTINATION_SOURCE };
  assert.equal(sameOrderDestination(persisted, candidate), true);
  assert.equal(sameOrderDestination({ ...persisted, line1: "999 Changed St" }, candidate), false);
  assert.equal(sameOrderDestination({ ...persisted, source: "browser" }, candidate), false);
});
