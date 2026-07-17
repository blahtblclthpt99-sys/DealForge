/**
 * AliExpress Affiliate / Portals config for DealForge.
 * Set ALIEXPRESS_AFF_SHORT_KEY (or tracking ID) when you have Portals credentials.
 */
export const ALIEXPRESS_AFF_SHORT_KEY =
  process.env.ALIEXPRESS_AFF_SHORT_KEY ||
  process.env.ALIEXPRESS_TRACKING_ID ||
  "";

export const ALIEXPRESS_PUBLISHER_ID =
  process.env.ALIEXPRESS_PUBLISHER_ID || "";

export function isAliExpressConfigured() {
  return Boolean(ALIEXPRESS_AFF_SHORT_KEY || ALIEXPRESS_PUBLISHER_ID);
}

/** Build an AliExpress search URL for a product keyword. */
export function buildAliExpressSearchUrl(query: string) {
  const q = encodeURIComponent(query.trim());
  return `https://www.aliexpress.com/w/wholesale-${q.replace(/%20/g, "-")}.html?SearchText=${q}`;
}

/**
 * Build a tracked AliExpress destination URL.
 * Uses Portals deep-link when an affiliate short key is configured.
 */
export function buildAliExpressAffiliateUrl(input: {
  productId?: string | null;
  url?: string | null;
  query?: string | null;
}) {
  const destination =
    input.url ||
    (input.productId
      ? `https://www.aliexpress.com/item/${input.productId}.html`
      : buildAliExpressSearchUrl(input.query || "deals"));

  let target: URL;
  try {
    target = new URL(destination);
  } catch {
    target = new URL(buildAliExpressSearchUrl("deals"));
  }

  if (ALIEXPRESS_PUBLISHER_ID) {
    target.searchParams.set("aff_platform", "portals-direct");
    target.searchParams.set("sk", ALIEXPRESS_PUBLISHER_ID);
  }

  if (!ALIEXPRESS_AFF_SHORT_KEY) {
    return target.toString();
  }

  // Official Portals-style deep link wrapper
  const deep = new URL("https://s.click.aliexpress.com/deep_link");
  deep.searchParams.set("dl_target_url", target.toString());
  deep.searchParams.set("aff_short_key", ALIEXPRESS_AFF_SHORT_KEY);
  if (ALIEXPRESS_PUBLISHER_ID) {
    deep.searchParams.set("af", ALIEXPRESS_PUBLISHER_ID);
  }
  return deep.toString();
}
