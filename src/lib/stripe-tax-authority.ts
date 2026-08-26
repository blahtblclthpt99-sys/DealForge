type StripeCheckoutObject = Record<string, unknown>;

export type CheckoutTaxAuthority = {
  mode: "automatic" | "disabled";
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
};

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeNonnegativeInteger(value: unknown, code: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(code);
  }
  return value;
}

function metadataOf(object: StripeCheckoutObject) {
  const metadata = record(object.metadata);
  return metadata ?? {};
}

/**
 * Checkout starts from DealForge's authoritative merchandise subtotal, but
 * Stripe is authoritative for the tax calculation once the hosted Session has
 * collected/validated the customer's location. Only a signed webhook should
 * call this validator.
 */
export function checkoutTaxAuthorityFromStripeSession(
  object: StripeCheckoutObject,
): CheckoutTaxAuthority {
  const metadata = metadataOf(object);
  const taxMode = metadata.dealforge_tax_mode;
  if (taxMode !== "automatic" && taxMode !== "disabled") {
    throw new Error("STRIPE_TAX_MODE_MISSING");
  }

  const automaticTax = record(object.automatic_tax);
  if (!automaticTax || typeof automaticTax.enabled !== "boolean") {
    throw new Error("STRIPE_AUTOMATIC_TAX_STATE_MISSING");
  }

  const totalDetails = record(object.total_details);
  if (!totalDetails) throw new Error("STRIPE_TOTAL_DETAILS_MISSING");

  const subtotalCents = safeNonnegativeInteger(
    object.amount_subtotal,
    "STRIPE_SUBTOTAL_INVALID",
  );
  const totalCents = safeNonnegativeInteger(
    object.amount_total,
    "STRIPE_TOTAL_INVALID",
  );
  const taxCents = safeNonnegativeInteger(
    totalDetails.amount_tax,
    "STRIPE_TAX_AMOUNT_INVALID",
  );
  const discountCents = safeNonnegativeInteger(
    totalDetails.amount_discount,
    "STRIPE_DISCOUNT_AMOUNT_INVALID",
  );
  const shippingRaw = totalDetails.amount_shipping;
  const shippingCents =
    shippingRaw === null || shippingRaw === undefined
      ? 0
      : safeNonnegativeInteger(shippingRaw, "STRIPE_SHIPPING_AMOUNT_INVALID");

  // DealForge does not currently expose coupons or Stripe shipping rates, so
  // silently accepting either would make the local financial ledger incomplete.
  if (discountCents !== 0) throw new Error("STRIPE_UNTRACKED_DISCOUNT");

  if (taxMode === "automatic") {
    if (automaticTax.enabled !== true) {
      throw new Error("STRIPE_AUTOMATIC_TAX_NOT_ENABLED");
    }
    if (automaticTax.status !== "complete") {
      throw new Error("STRIPE_AUTOMATIC_TAX_INCOMPLETE");
    }
  } else {
    if (automaticTax.enabled !== false) {
      throw new Error("STRIPE_TAX_MODE_MISMATCH");
    }
    if (taxCents !== 0) {
      throw new Error("STRIPE_UNEXPECTED_TAX");
    }
  }

  if (subtotalCents + shippingCents + taxCents !== totalCents) {
    throw new Error("STRIPE_TAX_TOTAL_MISMATCH");
  }

  return {
    mode: taxMode,
    subtotalCents,
    shippingCents,
    taxCents,
    totalCents,
  };
}

export function reconcileOrderTaxWithStripe(input: {
  authority: CheckoutTaxAuthority;
  orderSubtotalCents: number;
  orderShippingCents: number;
  orderTaxCents: number;
  orderTotalCents: number;
}) {
  const { authority } = input;
  if (authority.subtotalCents !== input.orderSubtotalCents) {
    throw new Error("STRIPE_SUBTOTAL_MISMATCH");
  }
  if (authority.shippingCents !== input.orderShippingCents) {
    throw new Error("STRIPE_SHIPPING_MISMATCH");
  }

  const provisionalTotal = input.orderSubtotalCents + input.orderShippingCents;
  const isProvisional =
    input.orderTaxCents === 0 && input.orderTotalCents === provisionalTotal;
  const isExactFinal =
    input.orderTaxCents === authority.taxCents &&
    input.orderTotalCents === authority.totalCents;

  if (!isProvisional && !isExactFinal) {
    throw new Error("STRIPE_TAX_LEDGER_IMMUTABLE_MISMATCH");
  }

  return {
    taxCents: authority.taxCents,
    totalCents: authority.totalCents,
  };
}
