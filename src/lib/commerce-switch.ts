import { parseCheckoutShippingCountries } from "./checkout-shipping";
import { expectedStripeLivemode } from "./stripe-commerce";

type CommerceSwitchEnv = {
  COMMERCE_ENABLED?: string;
  NODE_ENV?: string;
  STRIPE_AUTOMATIC_TAX_ENABLED?: string;
  TAX_COMPLIANCE_CERTIFIED?: string;
  SHIPPING_ADDRESS_CAPTURE_CERTIFIED?: string;
  CHECKOUT_ALLOWED_SHIPPING_COUNTRIES?: string;
};

/**
 * Emergency broad-catalog commerce lock.
 *
 * Keep this true until supplier persistence, source verification, landed-cost,
 * profit, inventory-confidence, tax, shipping-destination capture, and
 * production release gates are all certified. The private Stripe certification
 * product remains controlled separately by the checkout route's test-mode
 * certification bypass.
 */
export const BROAD_CATALOG_COMMERCE_LOCKED = true;

export type BroadCatalogCommerceActivationInput = {
  locked: boolean;
  commerceEnabled: boolean;
  production: boolean;
  stripeLivemode: boolean | null;
  stripeAutomaticTaxEnabled: boolean;
  taxComplianceCertified: boolean;
  shippingAddressCaptureCertified: boolean;
  shippingCountriesConfigured: boolean;
};

/**
 * Pure activation policy used for deterministic release-gate testing.
 * Production broad-catalog commerce is never eligible on Stripe test mode or
 * when Stripe mode cannot be proven. Production additionally requires explicit
 * tax-compliance, automatic-tax, and fulfillable shipping-destination gates.
 * Missing or misspelled configuration therefore fails closed. Non-production
 * environments can continue using test-mode Stripe without pretending that
 * production tax or fulfillment readiness exists.
 */
export function evaluateBroadCatalogCommerceActivation(
  input: BroadCatalogCommerceActivationInput,
) {
  if (input.locked || !input.commerceEnabled) return false;
  if (input.production) {
    if (input.stripeLivemode !== true) return false;
    if (!input.stripeAutomaticTaxEnabled || !input.taxComplianceCertified) return false;
    if (!input.shippingAddressCaptureCertified || !input.shippingCountriesConfigured) return false;
  }
  return true;
}

function authoritativeStripeLivemode(production: boolean) {
  if (!production) return null;
  try {
    return expectedStripeLivemode();
  } catch {
    return null;
  }
}

function shippingCountriesConfigured(raw: string | undefined) {
  try {
    return parseCheckoutShippingCountries(raw).length > 0;
  } catch {
    return false;
  }
}

export function isBroadCatalogCommerceEnabled(env?: CommerceSwitchEnv) {
  const source: CommerceSwitchEnv = env ?? {
    COMMERCE_ENABLED: process.env.COMMERCE_ENABLED,
    NODE_ENV: process.env.NODE_ENV,
    STRIPE_AUTOMATIC_TAX_ENABLED: process.env.STRIPE_AUTOMATIC_TAX_ENABLED,
    TAX_COMPLIANCE_CERTIFIED: process.env.TAX_COMPLIANCE_CERTIFIED,
    SHIPPING_ADDRESS_CAPTURE_CERTIFIED: process.env.SHIPPING_ADDRESS_CAPTURE_CERTIFIED,
    CHECKOUT_ALLOWED_SHIPPING_COUNTRIES: process.env.CHECKOUT_ALLOWED_SHIPPING_COUNTRIES,
  };
  const production = (source.NODE_ENV ?? process.env.NODE_ENV) === "production";
  const commerceEnabled = source.COMMERCE_ENABLED === "true";

  // Avoid touching Stripe configuration while the code-level emergency lock is
  // engaged. Once the lock is deliberately removed, the same function becomes
  // the authoritative live-mode + tax + fulfillment-destination interlock for
  // every production commerce gate.
  if (BROAD_CATALOG_COMMERCE_LOCKED || !commerceEnabled) return false;

  return evaluateBroadCatalogCommerceActivation({
    locked: BROAD_CATALOG_COMMERCE_LOCKED,
    commerceEnabled,
    production,
    stripeLivemode: authoritativeStripeLivemode(production),
    stripeAutomaticTaxEnabled: source.STRIPE_AUTOMATIC_TAX_ENABLED === "true",
    taxComplianceCertified: source.TAX_COMPLIANCE_CERTIFIED === "true",
    shippingAddressCaptureCertified: source.SHIPPING_ADDRESS_CAPTURE_CERTIFIED === "true",
    shippingCountriesConfigured: shippingCountriesConfigured(
      source.CHECKOUT_ALLOWED_SHIPPING_COUNTRIES,
    ),
  });
}
