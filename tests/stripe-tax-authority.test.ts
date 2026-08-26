import assert from "node:assert/strict";
import test from "node:test";
import {
  checkoutAutomaticTaxEnabled,
  paymentIntentUsesCheckoutTaxAuthority,
  STRIPE_CHECKOUT_TAX_AUTHORITY,
  validateStripeCheckoutTaxAuthority,
} from "../src/lib/stripe-tax-authority";

const order = {
  id: "order_tax_test",
  currency: "usd",
  status: "pending_payment",
  subtotalCents: 1000,
  shippingCents: 0,
  taxCents: 0,
  totalCents: 1000,
  stripeCheckoutSessionId: "cs_test_tax",
};

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_test_tax",
    currency: "usd",
    amount_subtotal: 1000,
    amount_total: 1083,
    automatic_tax: { enabled: true, status: "complete" },
    total_details: { amount_tax: 83 },
    ...overrides,
  };
}

test("recognizes Stripe Checkout automatic tax authority", () => {
  assert.equal(checkoutAutomaticTaxEnabled(session()), true);
  assert.deepEqual(validateStripeCheckoutTaxAuthority(order, session()), {
    enabled: true,
    sessionId: "cs_test_tax",
    subtotalCents: 1000,
    taxCents: 83,
    totalCents: 1083,
    currency: "usd",
  });
});

test("tax-disabled Checkout leaves existing order economics unchanged", () => {
  const result = validateStripeCheckoutTaxAuthority(order, session({ automatic_tax: { enabled: false, status: null } }));
  assert.deepEqual(result, { enabled: false });
});

test("rejects incomplete or inconsistent automatic tax", () => {
  assert.throws(
    () => validateStripeCheckoutTaxAuthority(order, session({ automatic_tax: { enabled: true, status: "requires_location_inputs" } })),
    /STRIPE_AUTOMATIC_TAX_NOT_COMPLETE/,
  );
  assert.throws(
    () => validateStripeCheckoutTaxAuthority(order, session({ amount_subtotal: 999 })),
    /STRIPE_TAX_SUBTOTAL_MISMATCH/,
  );
  assert.throws(
    () => validateStripeCheckoutTaxAuthority(order, session({ amount_total: 1084 })),
    /STRIPE_TAX_TOTAL_MISMATCH/,
  );
});

test("rejects a second conflicting tax amount snapshot", () => {
  const alreadyReconciled = { ...order, taxCents: 83, totalCents: 1083 };
  assert.doesNotThrow(() => validateStripeCheckoutTaxAuthority(alreadyReconciled, session()));
  assert.throws(
    () => validateStripeCheckoutTaxAuthority(alreadyReconciled, session({ amount_total: 1084, total_details: { amount_tax: 84 } })),
    /STRIPE_TAX_AMOUNT_IMMUTABLE_MISMATCH/,
  );
});

test("payment intent marker identifies Checkout-owned tax reconciliation", () => {
  assert.equal(paymentIntentUsesCheckoutTaxAuthority({ metadata: { tax_authority: STRIPE_CHECKOUT_TAX_AUTHORITY } }), true);
  assert.equal(paymentIntentUsesCheckoutTaxAuthority({ metadata: {} }), false);
});
