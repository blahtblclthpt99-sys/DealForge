import type { Prisma } from "@prisma/client";

export const STRIPE_CHECKOUT_TAX_AUTHORITY = "stripe_checkout_automatic_tax";

type OrderAmounts = {
  id: string;
  currency: string;
  status: string;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  stripeCheckoutSessionId: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function integerValue(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function metadataOf(object: Record<string, unknown>) {
  const metadata = record(object.metadata);
  if (!metadata) return {} as Record<string, string>;
  return Object.fromEntries(
    Object.entries(metadata).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

export function paymentIntentUsesCheckoutTaxAuthority(object: Record<string, unknown>) {
  return metadataOf(object).tax_authority === STRIPE_CHECKOUT_TAX_AUTHORITY;
}

export function checkoutAutomaticTaxEnabled(object: Record<string, unknown>) {
  return record(object.automatic_tax)?.enabled === true;
}

export function validateStripeCheckoutTaxAuthority(
  order: OrderAmounts,
  object: Record<string, unknown>,
) {
  if (!checkoutAutomaticTaxEnabled(object)) {
    return { enabled: false as const };
  }

  const sessionId = stringValue(object.id);
  if (!sessionId?.startsWith("cs_")) throw new Error("STRIPE_TAX_SESSION_ID_INVALID");
  if (!order.stripeCheckoutSessionId || order.stripeCheckoutSessionId !== sessionId) {
    throw new Error("STRIPE_TAX_SESSION_MISMATCH");
  }

  const automaticTax = record(object.automatic_tax)!;
  if (stringValue(automaticTax.status) !== "complete") {
    throw new Error("STRIPE_AUTOMATIC_TAX_NOT_COMPLETE");
  }

  const subtotalCents = integerValue(object.amount_subtotal);
  const totalCents = integerValue(object.amount_total);
  const totalDetails = record(object.total_details);
  const taxCents = integerValue(totalDetails?.amount_tax);
  const currency = stringValue(object.currency)?.toLowerCase();

  if (subtotalCents === null || subtotalCents <= 0) throw new Error("STRIPE_TAX_SUBTOTAL_INVALID");
  if (taxCents === null || taxCents < 0) throw new Error("STRIPE_TAX_AMOUNT_INVALID");
  if (totalCents === null || totalCents <= 0) throw new Error("STRIPE_TAX_TOTAL_INVALID");
  if (!currency || currency !== order.currency.toLowerCase()) throw new Error("STRIPE_TAX_CURRENCY_MISMATCH");
  if (subtotalCents !== order.subtotalCents) throw new Error("STRIPE_TAX_SUBTOTAL_MISMATCH");

  // DealForge does not yet quote a Stripe shipping rate. Until that separate
  // gate exists, any non-zero internal shipping amount would make this
  // reconciliation ambiguous and must fail closed.
  if (order.shippingCents !== 0) throw new Error("STRIPE_TAX_SHIPPING_NOT_CERTIFIED");
  if (totalCents !== subtotalCents + taxCents) throw new Error("STRIPE_TAX_TOTAL_MISMATCH");

  const pristine = order.taxCents === 0 && order.totalCents === order.subtotalCents;
  const same = order.taxCents === taxCents && order.totalCents === totalCents;
  if (!pristine && !same) throw new Error("STRIPE_TAX_AMOUNT_IMMUTABLE_MISMATCH");

  return {
    enabled: true as const,
    sessionId,
    subtotalCents,
    taxCents,
    totalCents,
    currency,
  };
}

export async function reconcileStripeCheckoutTaxAuthority(
  tx: Prisma.TransactionClient,
  input: { orderId: string; sourceEventId: string; object: Record<string, unknown> },
) {
  if (!input.sourceEventId.startsWith("evt_")) throw new Error("STRIPE_TAX_EVENT_ID_INVALID");
  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      currency: true,
      status: true,
      subtotalCents: true,
      shippingCents: true,
      taxCents: true,
      totalCents: true,
      stripeCheckoutSessionId: true,
    },
  });
  if (!order) throw new Error("STRIPE_TAX_ORDER_NOT_FOUND");

  const validated = validateStripeCheckoutTaxAuthority(order, input.object);
  if (!validated.enabled) return { order, authority: null };

  if (order.status === "refunded" || order.status === "partially_refunded" || order.status === "canceled") {
    throw new Error("STRIPE_TAX_ORDER_STATE_INVALID");
  }

  if (order.taxCents !== validated.taxCents || order.totalCents !== validated.totalCents) {
    await tx.order.update({
      where: { id: order.id },
      data: { taxCents: validated.taxCents, totalCents: validated.totalCents },
    });
  }

  await tx.systemLog.create({
    data: {
      level: "info",
      source: "stripe_tax_authority",
      message: "Authoritative Stripe Checkout tax amounts reconciled",
      meta: JSON.stringify({
        orderId: order.id,
        sourceEventId: input.sourceEventId,
        stripeCheckoutSessionId: validated.sessionId,
        subtotalCents: validated.subtotalCents,
        taxCents: validated.taxCents,
        totalCents: validated.totalCents,
        currency: validated.currency,
      }),
    },
  });

  return {
    order: { ...order, taxCents: validated.taxCents, totalCents: validated.totalCents },
    authority: { ...validated, sourceEventId: input.sourceEventId },
  };
}
