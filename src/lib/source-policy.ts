export const DIRECT_RESALE_SOURCE_CLASSES = [
  "manufacturer",
  "wholesale",
  "distributor",
  "authorized_dropshipper",
  "retailer_permitting_resale",
] as const;

export type DirectResaleSourceClass = (typeof DIRECT_RESALE_SOURCE_CLASSES)[number];

const DIRECT_RESALE_SOURCE_CLASS_SET = new Set<string>(DIRECT_RESALE_SOURCE_CLASSES);

export function isDirectResaleSourceClass(value: unknown): value is DirectResaleSourceClass {
  return typeof value === "string" && DIRECT_RESALE_SOURCE_CLASS_SET.has(value);
}

export const AUTHORIZED_AMAZON_PRICE_SOURCES = [
  "amazon_creators_api",
  "amazon_authorized_api",
  "amazon_owner_verified",
] as const;

export const AUTHORIZED_AMAZON_METADATA_SOURCES = [
  "amazon_creators_api",
  "amazon_authorized_api",
  "amazon_owner_verified",
] as const;

const AUTHORIZED_AMAZON_PRICE_SOURCE_SET = new Set<string>(AUTHORIZED_AMAZON_PRICE_SOURCES);
const AUTHORIZED_AMAZON_METADATA_SOURCE_SET = new Set<string>(AUTHORIZED_AMAZON_METADATA_SOURCES);

export const AMAZON_PRICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const AMAZON_METADATA_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function isFreshVerification(value: Date | null, maxAgeMs: number, nowMs = Date.now()) {
  if (!value || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) return false;
  const timestamp = value.getTime();
  if (!Number.isFinite(timestamp) || timestamp > nowMs) return false;
  return nowMs - timestamp <= maxAgeMs;
}

export function isAuthorizedAmazonPriceSource(value: string | null | undefined) {
  return Boolean(value && AUTHORIZED_AMAZON_PRICE_SOURCE_SET.has(value));
}

export function isAuthorizedAmazonMetadataSource(value: string | null | undefined) {
  return Boolean(value && AUTHORIZED_AMAZON_METADATA_SOURCE_SET.has(value));
}
