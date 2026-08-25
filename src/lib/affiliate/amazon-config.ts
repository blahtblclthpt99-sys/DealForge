/**
 * Amazon Associates account for DealForge.
 * Store ID / tracking ID configured via AMAZON_ASSOCIATE_TAG (default: titanfieldos-20).
 * Runtime URL generation resolves the tag lazily so the deployed request's
 * environment is authoritative rather than a build-time module snapshot.
 */
type AmazonAffiliateEnv = {
  AMAZON_ASSOCIATE_TAG?: string;
  AMAZON_PARTNER_TAG?: string;
};

const DEFAULT_AMAZON_ASSOCIATE_TAG = "titanfieldos-20";

export function getAmazonAssociateTag(env: AmazonAffiliateEnv = process.env) {
  return (
    env.AMAZON_ASSOCIATE_TAG ||
    env.AMAZON_PARTNER_TAG ||
    DEFAULT_AMAZON_ASSOCIATE_TAG
  ).trim();
}

/**
 * Legacy snapshots retained for existing CLI/seed imports. Runtime link
 * generation deliberately uses getAmazonAssociateTag() instead.
 */
export const AMAZON_ASSOCIATE_TAG =
  process.env.AMAZON_ASSOCIATE_TAG ||
  process.env.AMAZON_PARTNER_TAG ||
  DEFAULT_AMAZON_ASSOCIATE_TAG;

export const AMAZON_STORE_ID = AMAZON_ASSOCIATE_TAG;

/** Build a tracked Amazon product URL for this Associates account. */
export function buildAmazonProductUrl(asin: string) {
  const clean = asin.trim().toUpperCase();
  return `https://www.amazon.com/dp/${clean}?tag=${encodeURIComponent(getAmazonAssociateTag())}`;
}

/**
 * Official Amazon product image URLs (by ASIN).
 * Prefer these over placeholders so DealForge shows real Amazon photos.
 */
export function buildAmazonImageUrls(asin: string, sizes: number[] = [500, 1000]) {
  const clean = asin.trim().toUpperCase();
  return sizes.map(
    (size) =>
      `https://m.media-amazon.com/images/P/${clean}.01._SCLZZZZZZZ_SX${size}_.jpg`,
  );
}

/** Ensure any Amazon URL carries our Associates tag. */
export function withAmazonTag(url: string) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("amazon.")) return url;
    u.searchParams.set("tag", getAmazonAssociateTag());
    return u.toString();
  } catch {
    return url;
  }
}
