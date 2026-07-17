/**
 * eBay Partner Network credentials for DealForge.
 * SID and tracking key come from your eBay affiliate / Partner Network account.
 */
export const EBAY_AFFILIATE_SID =
  process.env.EBAY_AFFILIATE_SID || "";

/** Secondary tracking / media credential from eBay Partner Network */
export const EBAY_AFFILIATE_TRACKING_ID =
  process.env.EBAY_AFFILIATE_TRACKING_ID || "";

/** US eBay Partner Network rotation ID */
export const EBAY_MKRID = "711-53200-19255-0";

export function isEbayAffiliateConfigured() {
  return Boolean(EBAY_AFFILIATE_SID);
}

/**
 * Build a tracked eBay product / destination URL.
 * Uses Partner Network rover + your SID so commissions can attribute correctly.
 */
export function buildEbayAffiliateUrl(input: {
  itemId?: string | null;
  url?: string | null;
}) {
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

  if (EBAY_AFFILIATE_SID) {
    target.searchParams.set("sid", EBAY_AFFILIATE_SID);
    target.searchParams.set("customid", EBAY_AFFILIATE_SID);
  }

  if (EBAY_AFFILIATE_TRACKING_ID) {
    target.searchParams.set("campid", EBAY_AFFILIATE_TRACKING_ID);
  }

  // Rover wrap improves attribution reliability for Partner Network accounts
  if (!EBAY_AFFILIATE_SID) {
    return target.toString();
  }

  const rover = new URL(`https://rover.ebay.com/rover/1/${EBAY_MKRID}/1`);
  rover.searchParams.set("icep_id", "114");
  rover.searchParams.set("ipn", "icep");
  rover.searchParams.set("toolid", "20004");
  rover.searchParams.set("mpre", target.toString());
  rover.searchParams.set("customid", EBAY_AFFILIATE_SID);
  if (EBAY_AFFILIATE_TRACKING_ID) {
    rover.searchParams.set("campid", EBAY_AFFILIATE_TRACKING_ID);
  }
  return rover.toString();
}
