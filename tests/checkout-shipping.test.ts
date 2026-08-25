import assert from "node:assert/strict";
import test from "node:test";
import {
  extractCheckoutShippingDestination,
  parseCheckoutShippingCountries,
} from "../src/lib/checkout-shipping";

test("shipping country config normalizes and deduplicates ISO alpha-2 values", () => {
  assert.deepEqual(parseCheckoutShippingCountries(" us,CA,us "), ["US", "CA"]);
  assert.deepEqual(parseCheckoutShippingCountries(""), []);
  assert.deepEqual(parseCheckoutShippingCountries(undefined), []);
  assert.throws(
    () => parseCheckoutShippingCountries("USA"),
    /CHECKOUT_SHIPPING_COUNTRY_INVALID/,
  );
});

test("shipping extraction accepts current collected_information Checkout payloads", () => {
  assert.deepEqual(
    extractCheckoutShippingDestination({
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
    }),
    {
      name: "Ada Buyer",
      line1: "123 Main St",
      line2: "Unit 4",
      city: "Oklahoma City",
      state: "OK",
      postalCode: "73102",
      country: "US",
    },
  );
});

test("shipping extraction remains compatible with legacy Checkout payloads", () => {
  assert.deepEqual(
    extractCheckoutShippingDestination({
      shipping_details: {
        name: "Legacy Buyer",
        address: {
          line1: "55 Market St",
          city: "San Francisco",
          state: "CA",
          postal_code: "94105",
          country: "US",
        },
      },
    }),
    {
      name: "Legacy Buyer",
      line1: "55 Market St",
      line2: null,
      city: "San Francisco",
      state: "CA",
      postalCode: "94105",
      country: "US",
    },
  );
});

test("missing shipping data is distinguishable from malformed partial shipping data", () => {
  assert.equal(extractCheckoutShippingDestination({}), null);
  assert.throws(
    () =>
      extractCheckoutShippingDestination({
        collected_information: {
          shipping_details: {
            name: "Partial Buyer",
            address: { line1: "123 Main St", country: "US" },
          },
        },
      }),
    /STRIPE_SHIPPING_DETAILS_INVALID/,
  );
});
