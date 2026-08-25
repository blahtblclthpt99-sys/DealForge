/**
 * eBay Partner Network credentials for DealForge.
 * SID and tracking key come from your eBay affiliate / Partner Network account.
 * Runtime link generation resolves environment values lazily so request-version
 * Cloudflare bindings cannot be replaced by an empty build-time snapshot.
 */
type EbayAffiliateEnv = Record<string, string | undefined> & {
  EBAY_AFFILIATE_SID?: string;
  EBAY_AFFILIATE_TRACKING_ID?: string;
};

export function getEbayAffiliateConfig(env: EbayAffiliateEnv = process.env) {
  return {
    sid: (env.EBAY_AFFILIATE_SID || "").trim(),
    trackingId: (env.EBAY_AFFILIATE_TRACKING_ID || "").trim(),
  };
}

/**
 * Legacy snapshots retained for existing CLI/seed imports. Request-time link
 * generation and configuration checks deliberately do not use these values.
 */
export const EBAY_AFFILIATE_SID =
  process.env.EBAY_AFFILIATE_SID || "";

/** Secondary tracking / media credential from eBay Partner Network */
export const EBAY_AFFILIATE_TRACKING_ID =
  process.env.EBAY_AFFILIATE_TRACKING_ID || "";

/** US eBay Partner Network rotation ID */
export const EBAY_MKRID = "711-53200-19255-0";

export function isEbayAffiliateConfigured() {
  return Boolean(getEbayAffiliateConfig().sid);
}

/**
 * Build a tracked eBay product / destination URL.
 * Uses Partner Network rover + your SID so commissions can attribute correctly.
 */
export function buildEbayAffiliateUrl(input: {
  itemId?: string | null;
  url?: string | null;
}) {
  const { sid, trackingId } = getEbayAffiliateConfig();
  const raw =
    input.url ||
    (input.itemId
      ? `https://www.ebay.com/itm/${String(input.itemId).replace(/\D/g, "")}`
      : "https://www.ebay.com");

  // If we already have a rover link, return it as-is (avoid double-wrapping)
  if (raw.includes("rover.ebay.com")) {
    return raw;
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    target = new URL("https://www.ebay.com");
  }

  // Standard eBay Partner Network click-tracking parameters (US)
  target.searchParams.set("mkevt", "1");
  target.searchParams.set("mkcid", "1");
  target.searchParams.set("mkrid", EBAY_MKRID);
  target.searchParams.set("siteid", "0");
  target.searchParams.set("toolid", "10001");

  if (sid) {
    target.searchParams.set("sid", sid);
    target.searchParams.set("customid", sid);
  }

  if (trackingId) {
    target.searchParams.set("campid", trackingId);
  }

  // Rover wrap improves attribution reliability for Partner Network accounts
  if (!sid) {
    return target.toString();
  }

  const rover = new URL(`https://rover.ebay.com/rover/1/${EBAY_MKRID}/1`);
  rover.searchParams.set("icep_id", "114");
  rover.searchParams.set("ipn", "icep");
  rover.searchParams.set("toolid", "20004");
  rover.searchParams.set("mpre", target.toString());
  rover.searchParams.set("customid", sid);
  if (trackingId) {
    rover.searchParams.set("campid", trackingId);
  }
  return rover.toString();
}
