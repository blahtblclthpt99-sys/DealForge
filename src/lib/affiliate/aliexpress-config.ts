/**
 * AliExpress Affiliate / Portals config for DealForge.
 * Set ALIEXPRESS_AFF_SHORT_KEY (or tracking ID) when you have Portals credentials.
 *
 * Runtime consumers must resolve environment-backed values lazily. DealForge's
 * Cloudflare Worker hydrates process.env from the exact request version before
 * OpenNext handles the request; reading here at call time prevents build-time or
 * isolate-initialization snapshots from suppressing affiliate attribution.
 */
type AliExpressAffiliateEnv = Record<string, string | undefined> & {
  ALIEXPRESS_AFF_SHORT_KEY?: string;
  ALIEXPRESS_TRACKING_ID?: string;
  ALIEXPRESS_PUBLISHER_ID?: string;
};

export function getAliExpressAffiliateConfig(
  env: AliExpressAffiliateEnv = process.env,
) {
  return {
    shortKey: (
      env.ALIEXPRESS_AFF_SHORT_KEY ||
      env.ALIEXPRESS_TRACKING_ID ||
      ""
    ).trim(),
    publisherId: (env.ALIEXPRESS_PUBLISHER_ID || "").trim(),
  };
}

/**
 * Legacy snapshots retained only for existing build/seed scripts that import
 * these names. Request-time URL generation does not use them.
 */
export const ALIEXPRESS_AFF_SHORT_KEY =
  process.env.ALIEXPRESS_AFF_SHORT_KEY ||
  process.env.ALIEXPRESS_TRACKING_ID ||
  "";

export const ALIEXPRESS_PUBLISHER_ID =
  process.env.ALIEXPRESS_PUBLISHER_ID || "";

export function isAliExpressConfigured() {
  const config = getAliExpressAffiliateConfig();
  return Boolean(config.shortKey || config.publisherId);
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
  const { shortKey, publisherId } = getAliExpressAffiliateConfig();
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

  if (publisherId) {
    target.searchParams.set("aff_platform", "portals-direct");
    target.searchParams.set("sk", publisherId);
  }

  if (!shortKey) {
    return target.toString();
  }

  // Official Portals-style deep link wrapper
  const deep = new URL("https://s.click.aliexpress.com/deep_link");
  deep.searchParams.set("dl_target_url", target.toString());
  deep.searchParams.set("aff_short_key", shortKey);
  if (publisherId) {
    deep.searchParams.set("af", publisherId);
  }
  return deep.toString();
}
