export type CheckoutShippingDestination = {
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postalCode: string;
  country: string;
};

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textOf(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Parse the operator-controlled list passed to Stripe Checkout's
 * shipping_address_collection.allowed_countries field.
 *
 * Empty configuration intentionally produces an empty list. Production
 * activation is responsible for failing closed when no shipping countries are
 * configured. This parser only accepts normalized ISO-3166 alpha-2 shaped
 * values; Stripe remains authoritative for its supported-country subset.
 */
export function parseCheckoutShippingCountries(raw: string | null | undefined) {
  if (!raw?.trim()) return [];
  const countries = raw
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

  const unique: string[] = [];
  for (const country of countries) {
    if (!/^[A-Z]{2}$/.test(country)) {
      throw new Error("CHECKOUT_SHIPPING_COUNTRY_INVALID");
    }
    if (!unique.includes(country)) unique.push(country);
  }
  return unique;
}

/**
 * Stripe's Basil API moved Checkout Session shipping details from the legacy
 * top-level `shipping_details` field to
 * `collected_information.shipping_details`. Accept both representations so
 * DealForge remains deterministic across account API-version transitions.
 *
 * The returned value is a normalized fulfillment snapshot. Partial address
 * payloads fail closed instead of being silently persisted as usable shipping
 * instructions.
 */
export function extractCheckoutShippingDestination(
  object: Record<string, unknown>,
): CheckoutShippingDestination | null {
  const collectedInformation = recordOf(object.collected_information);
  const shippingDetails =
    recordOf(collectedInformation?.shipping_details) ?? recordOf(object.shipping_details);
  if (!shippingDetails) return null;

  const address = recordOf(shippingDetails.address);
  const name = textOf(shippingDetails.name);
  const line1 = textOf(address?.line1);
  const line2 = textOf(address?.line2);
  const city = textOf(address?.city);
  const state = textOf(address?.state);
  const postalCode = textOf(address?.postal_code);
  const country = textOf(address?.country)?.toUpperCase() ?? null;

  if (
    !name ||
    !line1 ||
    !city ||
    !postalCode ||
    !country ||
    !/^[A-Z]{2}$/.test(country)
  ) {
    throw new Error("STRIPE_SHIPPING_DETAILS_INVALID");
  }

  return {
    name,
    line1,
    line2,
    city,
    state,
    postalCode,
    country,
  };
}
