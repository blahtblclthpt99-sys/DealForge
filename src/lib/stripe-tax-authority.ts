export type StripeTaxAuthorityOrder = {
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
};

export type StripeTaxAuthorityResult = {
  automaticTaxEnabled: boolean;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
};

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asSafeNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function asSafePositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function asCurrency(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z]{3}$/.test(value)
    ? value.toLowerCase()
    : null;
}

/**
 * Resolve the authoritative Stripe Checkout financial totals for an order.
 *
 * DealForge remains authoritative for the pre-tax merchandise subtotal and the
 * configured shipping amount. Stripe may become authoritative for tax only on
 * a Checkout Session carrying automatic_tax.enabled=true and
 * automatic_tax.status=complete. Discounts are deliberately rejected until a
 * separately certified promotion/discount ledger exists.
 *
 * Non-tax sessions retain the pre-existing amount/currency contract so this
 * foundation does not disturb the already-certified shipping-only path.
 */
export function resolveStripeCheckoutTaxAuthority(
  order: StripeTaxAuthorityOrder,
  object: Record<string, unknown>,
): StripeTaxAuthorityResult {
  const currency = asCurrency(object.currency);
  if (!currency || currency !== order.currency.toLowerCase()) {
    throw new Error("WEBHOOK_CURRENCY_MISMATCH");
  }

  const amountTotal = asSafePositiveInteger(object.amount_total);
  if (amountTotal === null) throw new Error("STRIPE_CHECKOUT_TOTAL_MISSING");

  const automaticTax = asRecord(object.automatic_tax);
  const automaticTaxEnabled = automaticTax?.enabled === true;
  if (!automaticTaxEnabled) {
    if (amountTotal !== order.totalCents) {
      throw new Error("WEBHOOK_AMOUNT_MISMATCH");
    }
    return {
      automaticTaxEnabled: false,
      subtotalCents: order.subtotalCents,
      shippingCents: order.shippingCents,
      taxCents: order.taxCents,
      totalCents: order.totalCents,
      currency,
    };
  }

  const amountSubtotal = asSafePositiveInteger(object.amount_subtotal);
  if (amountSubtotal === null) throw new Error("STRIPE_CHECKOUT_SUBTOTAL_MISSING");
  if (amountSubtotal !== order.subtotalCents) {
    throw new Error("WEBHOOK_SUBTOTAL_MISMATCH");
  }
  if (automaticTax?.status !== "complete") {
    throw new Error("STRIPE_AUTOMATIC_TAX_INCOMPLETE");
  }

  const totalDetails = asRecord(object.total_details);
  if (!totalDetails) throw new Error("STRIPE_TOTAL_DETAILS_MISSING");

  const taxCents = asSafeNonNegativeInteger(totalDetails.amount_tax);
  const shippingCents = asSafeNonNegativeInteger(totalDetails.amount_shipping);
  const discountCents = asSafeNonNegativeInteger(totalDetails.amount_discount);
  if (taxCents === null || shippingCents === null || discountCents === null) {
    throw new Error("STRIPE_TOTAL_DETAILS_INVALID");
  }
  if (discountCents !== 0) throw new Error("STRIPE_DISCOUNT_NOT_CERTIFIED");
  if (shippingCents !== order.shippingCents) {
    throw new Error("WEBHOOK_SHIPPING_AMOUNT_MISMATCH");
  }

  const expectedTotal = order.subtotalCents + shippingCents + taxCents;
  if (!Number.isSafeInteger(expectedTotal) || expectedTotal <= 0 || amountTotal !== expectedTotal) {
    throw new Error("WEBHOOK_TAX_TOTAL_MISMATCH");
  }

  return {
    automaticTaxEnabled: true,
    subtotalCents: order.subtotalCents,
    shippingCents,
    taxCents,
    totalCents: amountTotal,
    currency,
  };
}
