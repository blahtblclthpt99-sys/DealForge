type CommerceSwitchEnv = {
  COMMERCE_ENABLED?: string;
};

/**
 * Emergency broad-catalog commerce lock.
 *
 * Keep this true until supplier persistence, source verification, landed-cost,
 * profit, inventory-confidence, and production release gates are all certified.
 * The private Stripe certification product remains controlled separately by
 * the checkout route's test-mode certification bypass.
 */
export const BROAD_CATALOG_COMMERCE_LOCKED = true;

export function isBroadCatalogCommerceEnabled(env: CommerceSwitchEnv = process.env) {
  if (BROAD_CATALOG_COMMERCE_LOCKED) return false;
  return env.COMMERCE_ENABLED === "true";
}
