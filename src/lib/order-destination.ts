import type { Prisma } from "@prisma/client";
import {
  extractCheckoutShippingDestination,
  parseCheckoutShippingCountries,
  type CheckoutShippingDestination,
} from "@/lib/checkout-shipping";

export const ORDER_DESTINATION_SOURCE = "stripe_checkout" as const;

export type PreparedOrderDestination = CheckoutShippingDestination & {
  stripeCheckoutSessionId: string;
};

type PersistedOrderDestination = PreparedOrderDestination & {
  source: string;
};

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function prepareCheckoutOrderDestination(
  object: Record<string, unknown>,
  allowedCountriesRaw: string | null | undefined = process.env.CHECKOUT_ALLOWED_SHIPPING_COUNTRIES,
): PreparedOrderDestination {
  const stripeCheckoutSessionId = nonEmptyString(object.id) ? object.id.trim() : "";
  if (!/^cs_[A-Za-z0-9_]+$/.test(stripeCheckoutSessionId)) {
    throw new Error("ORDER_DESTINATION_CHECKOUT_SESSION_INVALID");
  }

  const destination = extractCheckoutShippingDestination(object);
  if (!destination) throw new Error("ORDER_DESTINATION_MISSING");

  const allowedCountries = parseCheckoutShippingCountries(allowedCountriesRaw);
  if (allowedCountries.length === 0) {
    throw new Error("ORDER_DESTINATION_COUNTRIES_NOT_CONFIGURED");
  }
  if (!allowedCountries.includes(destination.country)) {
    throw new Error("ORDER_DESTINATION_COUNTRY_NOT_ALLOWED");
  }
  if (destination.country === "US" && !destination.state) {
    throw new Error("ORDER_DESTINATION_STATE_REQUIRED");
  }

  return { stripeCheckoutSessionId, ...destination };
}

export function sameOrderDestination(
  persisted: PersistedOrderDestination,
  candidate: PreparedOrderDestination,
) {
  return (
    persisted.source === ORDER_DESTINATION_SOURCE &&
    persisted.stripeCheckoutSessionId === candidate.stripeCheckoutSessionId &&
    persisted.name === candidate.name &&
    persisted.line1 === candidate.line1 &&
    persisted.line2 === candidate.line2 &&
    persisted.city === candidate.city &&
    persisted.state === candidate.state &&
    persisted.postalCode === candidate.postalCode &&
    persisted.country === candidate.country
  );
}

/**
 * Persist the immutable fulfillment destination from a signature-verified
 * Stripe Checkout Session event. Browser request bodies are never accepted as
 * an address authority.
 */
export async function persistCheckoutOrderDestination(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    sourceEventId: string;
    object: Record<string, unknown>;
  },
) {
  if (!/^evt_[A-Za-z0-9_]+$/.test(input.sourceEventId)) {
    throw new Error("ORDER_DESTINATION_EVENT_INVALID");
  }

  const candidate = prepareCheckoutOrderDestination(input.object);
  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      stripeCheckoutSessionId: true,
      destination: {
        select: {
          id: true,
          source: true,
          sourceEventId: true,
          stripeCheckoutSessionId: true,
          name: true,
          line1: true,
          line2: true,
          city: true,
          state: true,
          postalCode: true,
          country: true,
          capturedAt: true,
        },
      },
    },
  });
  if (!order) throw new Error("ORDER_DESTINATION_ORDER_NOT_FOUND");
  if (!order.stripeCheckoutSessionId) {
    throw new Error("ORDER_DESTINATION_SESSION_NOT_BOUND");
  }
  if (order.stripeCheckoutSessionId !== candidate.stripeCheckoutSessionId) {
    throw new Error("ORDER_DESTINATION_SESSION_MISMATCH");
  }

  if (order.destination) {
    if (!sameOrderDestination(order.destination, candidate)) {
      throw new Error("ORDER_DESTINATION_IMMUTABLE_MISMATCH");
    }
    return { destination: order.destination, created: false };
  }

  const destination = await tx.orderDestination.create({
    data: {
      orderId: order.id,
      source: ORDER_DESTINATION_SOURCE,
      sourceEventId: input.sourceEventId,
      stripeCheckoutSessionId: candidate.stripeCheckoutSessionId,
      name: candidate.name,
      line1: candidate.line1,
      line2: candidate.line2,
      city: candidate.city,
      state: candidate.state,
      postalCode: candidate.postalCode,
      country: candidate.country,
    },
  });
  return { destination, created: true };
}
