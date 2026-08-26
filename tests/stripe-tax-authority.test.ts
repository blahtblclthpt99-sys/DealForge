import test from "node:test";
import assert from "node:assert/strict";
import { resolveStripeCheckoutTaxAuthority } from "../src/lib/stripe-tax-authority";

const order = {
  subtotalCents: 10_000,
  shippingCents: 0,
  taxCents: 0,
  totalCents: 10_000,
  currency: "usd",
};

test("preserves pre-tax order totals when automatic tax is disabled", () => {
  assert.deepEqual(
    resolveStripeCheckoutTaxAuthority(order, {
      currency: "usd",
      amount_subtotal: 10_000,
      amount_total: 10_000,
      automatic_tax: { enabled: false },
    }),
    {
      automaticTaxEnabled: false,
      subtotalCents: 10_000,
      shippingCents: 0,
      taxCents: 0,
      totalCents: 10_000,
      currency: "usd",
    },
  );
});

test("accepts completed Stripe automatic-tax totals as tax authority", () => {
  assert.deepEqual(
    resolveStripeCheckoutTaxAuthority(order, {
      currency: "usd",
      amount_subtotal: 10_000,
      amount_total: 10_825,
      automatic_tax: { enabled: true, status: "complete" },
      total_details: {
        amount_discount: 0,
        amount_shipping: 0,
        amount_tax: 825,
      },
    }),
    {
      automaticTaxEnabled: true,
      subtotalCents: 10_000,
      shippingCents: 0,
      taxCents: 825,
      totalCents: 10_825,
      currency: "usd",
    },
  );
});

test("rejects a Stripe subtotal that no longer matches DealForge merchandise authority", () => {
  assert.throws(
    () => resolveStripeCheckoutTaxAuthority(order, {
      currency: "usd",
      amount_subtotal: 9_999,
      amount_total: 10_824,
      automatic_tax: { enabled: true, status: "complete" },
      total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 825 },
    }),
    /WEBHOOK_SUBTOTAL_MISMATCH/,
  );
});

test("rejects incomplete automatic-tax computation", () => {
  assert.throws(
    () => resolveStripeCheckoutTaxAuthority(order, {
      currency: "usd",
      amount_subtotal: 10_000,
      amount_total: 10_825,
      automatic_tax: { enabled: true, status: "requires_location_inputs" },
      total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 825 },
    }),
    /STRIPE_AUTOMATIC_TAX_INCOMPLETE/,
  );
});

test("rejects discounts until discount accounting is separately certified", () => {
  assert.throws(
    () => resolveStripeCheckoutTaxAuthority(order, {
      currency: "usd",
      amount_subtotal: 10_000,
      amount_total: 10_725,
      automatic_tax: { enabled: true, status: "complete" },
      total_details: { amount_discount: 100, amount_shipping: 0, amount_tax: 825 },
    }),
    /STRIPE_DISCOUNT_NOT_CERTIFIED/,
  );
});

test("rejects tax totals that do not reconcile exactly", () => {
  assert.throws(
    () => resolveStripeCheckoutTaxAuthority(order, {
      currency: "usd",
      amount_subtotal: 10_000,
      amount_total: 10_824,
      automatic_tax: { enabled: true, status: "complete" },
      total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 825 },
    }),
    /WEBHOOK_TAX_TOTAL_MISMATCH/,
  );
});
