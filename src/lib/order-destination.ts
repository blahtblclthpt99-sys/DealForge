import type { Prisma } from "@prisma/client";
import {
  isCertificationCatalogId,
  LEGACY_STRIPE_CERTIFICATION_PRODUCT_ID,
} from "./certification-catalog";
import {
  extractCheckoutShippingDestination,
  parseCheckoutShippingCountries,
  type CheckoutShippingDestination,
} from "./checkout-shipping";

export type PersistedOrderDestinationShape = CheckoutShippingDestination & {
  providerSessionId: string;
};

function sessionIdOf(object: Record<string, unknown>) {
  const id = typeof object.id === "string" ? object.id : "";
  if (!id.startsWith("cs_")) throw new Error("STRIPE_CHECKOUT_SESSION_ID_INVALID");
  return id;
}

export function isCertificationProductId(productId: string) {
  return (
    productId === LEGACY_STRIPE_CERTIFICATION_PRODUCT_ID ||
    isCertificationCatalogId(productId)
  );
}

export function sameOrderDestination(
  existing: {
    providerSessionId: string;
    recipientName: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string | null;
    postalCode: string;
    country: string;
  },
  candidate: PersistedOrderDestinationShape,
) {
  return (
    existing.providerSessionId === candidate.providerSessionId &&
    existing.recipientName === candidate.name &&
    existing.line1 === candidate.line1 &&
    existing.line2 === candidate.line2 &&
    existing.city === candidate.city &&
    existing.state === candidate.state &&
    existing.postalCode === candidate.postalCode &&
    existing.country === candidate.country
  );
}

export async function orderRequiresShipping(
  tx: Prisma.TransactionClient,
  orderId: string,
) {
  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: { productId: true },
  });
  if (items.length === 0) throw new Error("ORDER_ITEMS_MISSING");
  return items.some((item) => !isCertificationProductId(item.productId));
}

function assertAllowedShippingCountry(country: string) {
  const allowed = parseCheckoutShippingCountries(
    process.env.CHECKOUT_ALLOWED_SHIPPING_COUNTRIES,
  );
  if (allowed.length === 0) throw new Error("CHECKOUT_SHIPPING_COUNTRIES_NOT_CONFIGURED");
  if (!allowed.includes(country)) throw new Error("WEBHOOK_SHIPPING_COUNTRY_NOT_ALLOWED");
}

/**
 * Persist the customer-selected Stripe Checkout destination exactly once.
 * Existing records are immutable: an exact replay is accepted, while any
 * session/address drift fails closed. Certification-only orders deliberately
 * bypass this table so the existing Stripe test certification path remains
 * deploy-safe before the production migration is applied.
 */
export async function persistAuthoritativeCheckoutDestination(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    eventId: string;
    object: Record<string, unknown>;
  },
) {
  const required = await orderRequiresShipping(tx, input.orderId);
  if (!required) return { required: false, persisted: false };

  const providerSessionId = sessionIdOf(input.object);
  const destination = extractCheckoutShippingDestination(input.object);
  if (!destination) throw new Error("WEBHOOK_SHIPPING_DESTINATION_MISSING");
  assertAllowedShippingCountry(destination.country);

  const candidate: PersistedOrderDestinationShape = {
    ...destination,
    providerSessionId,
  };
  const existing = await tx.orderDestination.findUnique({
    where: { orderId: input.orderId },
  });
  if (existing) {
    if (!sameOrderDestination(existing, candidate)) {
      throw new Error("WEBHOOK_SHIPPING_DESTINATION_MISMATCH");
    }
    return { required: true, persisted: false };
  }

  await tx.orderDestination.create({
    data: {
      orderId: input.orderId,
      source: "stripe_checkout",
      providerSessionId,
      sourceEventId: input.eventId,
      recipientName: destination.name,
      line1: destination.line1,
      line2: destination.line2,
      city: destination.city,
      state: destination.state,
      postalCode: destination.postalCode,
      country: destination.country,
    },
  });
  return { required: true, persisted: true };
}

/**
 * Payment success is allowed to create procurement intent only after a
 * physical-goods order has an authoritative destination. PaymentIntent events
 * can arrive before Checkout Session events; throwing here keeps that event
 * retryable until Checkout supplies the destination.
 */
export async function assertAuthoritativeDestinationReady(
  tx: Prisma.TransactionClient,
  orderId: string,
) {
  const required = await orderRequiresShipping(tx, orderId);
  if (!required) return;
  const destination = await tx.orderDestination.findUnique({
    where: { orderId },
    select: { id: true },
  });
  if (!destination) throw new Error("WEBHOOK_SHIPPING_DESTINATION_MISSING");
}
