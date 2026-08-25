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

/**
 * Canonical DealForge source-authorization freshness boundary. This is shared
 * by commercialization and operational inventory adapters so a source cannot
 * remain machine-authorized after the verification window used for commerce
 * has expired.
 */
export const DIRECT_RESALE_SOURCE_MAX_AGE_DAYS = 30;
export const DIRECT_RESALE_SOURCE_MAX_AGE_MS = DIRECT_RESALE_SOURCE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
export const SOURCE_VERIFICATION_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export type DirectResaleSourceAuthorizationInput = {
  active: boolean;
  sourceClass: string;
  resaleAllowed: boolean;
  sourceVerifiedAt: Date | null;
};

export type DirectResaleSourceAuthorizationDecision = {
  allowed: boolean;
  reasons: string[];
};

export function evaluateDirectResaleSourceAuthorization(
  input: DirectResaleSourceAuthorizationInput,
  nowMs = Date.now(),
): DirectResaleSourceAuthorizationDecision {
  const reasons: string[] = [];
  if (!input.active) reasons.push("source_inactive");
  if (!isDirectResaleSourceClass(input.sourceClass)) reasons.push("source_class_not_direct_resale");
  if (!input.resaleAllowed) reasons.push("resale_not_verified");

  const verifiedAt = input.sourceVerifiedAt?.getTime() ?? Number.NaN;
  if (!Number.isFinite(verifiedAt) || verifiedAt > nowMs + SOURCE_VERIFICATION_FUTURE_TOLERANCE_MS) {
    reasons.push("source_verification_invalid");
  } else if (nowMs - verifiedAt > DIRECT_RESALE_SOURCE_MAX_AGE_MS) {
    reasons.push("source_verification_stale");
  }

  return { allowed: reasons.length === 0, reasons };
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
