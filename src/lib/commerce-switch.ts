import { expectedStripeLivemode } from "./stripe-commerce";

type CommerceSwitchEnv = {
  COMMERCE_ENABLED?: string;
  NODE_ENV?: string;
};

/**
 * Emergency broad-catalog commerce lock.
 *
 * Keep this true until supplier persistence, source verification, landed-cost,
 * profit, inventory-confidence, tax, and production release gates are all
 * certified. The private Stripe certification product remains controlled
 * separately by the checkout route's test-mode certification bypass.
 */
export const BROAD_CATALOG_COMMERCE_LOCKED = true;

export type BroadCatalogCommerceActivationInput = {
  locked: boolean;
  commerceEnabled: boolean;
  production: boolean;
  stripeLivemode: boolean | null;
};

/**
 * Pure activation policy used for deterministic release-gate testing.
 * Production broad-catalog commerce is never eligible on Stripe test mode or
 * when Stripe mode cannot be proven. Non-production environments can continue
 * using test-mode Stripe for local/integration development.
 */
export function evaluateBroadCatalogCommerceActivation(
  input: BroadCatalogCommerceActivationInput,
) {
  if (input.locked || !input.commerceEnabled) return false;
  if (input.production && input.stripeLivemode !== true) return false;
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

export function isBroadCatalogCommerceEnabled(env?: CommerceSwitchEnv) {
  const source: CommerceSwitchEnv = env ?? {
    COMMERCE_ENABLED: process.env.COMMERCE_ENABLED,
    NODE_ENV: process.env.NODE_ENV,
  };
  const production = (source.NODE_ENV ?? process.env.NODE_ENV) === "production";
  const commerceEnabled = source.COMMERCE_ENABLED === "true";

  // Avoid touching Stripe configuration while the code-level emergency lock is
  // engaged. Once the lock is deliberately removed, the same function becomes
  // the authoritative live-mode interlock for every production commerce gate.
  if (BROAD_CATALOG_COMMERCE_LOCKED || !commerceEnabled) return false;

  return evaluateBroadCatalogCommerceActivation({
    locked: BROAD_CATALOG_COMMERCE_LOCKED,
    commerceEnabled,
    production,
    stripeLivemode: authoritativeStripeLivemode(production),
  });
}
