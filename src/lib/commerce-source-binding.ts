export type CommerceSourceBindingReason =
  | "SOURCE_BOUND"
  | "SOURCE_IDENTITY_MISSING"
  | "SOURCE_IDENTITY_INVALID"
  | "SOURCE_IDENTITY_DRIFT";

export type CommerceSourceBindingInput = {
  retailer: string;
  sourceUrl: string;
  asin: string | null;
  specifications: unknown;
};

export type CommerceSourceBindingResult = {
  bound: boolean;
  reason: CommerceSourceBindingReason;
  retailer: string | null;
  sourceUrl: string | null;
  asin: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseSpecifications(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return record(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return record(value);
}

function normalizeAsin(value: string | null) {
  const normalized = value?.trim().toUpperCase() || null;
  return normalized;
}

function normalizeHttpsUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local")
    ) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function result(
  bound: boolean,
  reason: CommerceSourceBindingReason,
  retailer: string | null = null,
  sourceUrl: string | null = null,
  asin: string | null = null,
): CommerceSourceBindingResult {
  return { bound, reason, retailer, sourceUrl, asin };
}

export function checkRecommendationSourceBinding(
  input: CommerceSourceBindingInput,
): CommerceSourceBindingResult {
  const specifications = parseSpecifications(input.specifications);
  const recommendation = specifications ? record(specifications.commerceRecommendation) : null;
  const sourceIdentity = recommendation ? record(recommendation.sourceIdentity) : null;
  if (!sourceIdentity) return result(false, "SOURCE_IDENTITY_MISSING");

  const currentRetailer = input.retailer.trim().toLowerCase();
  const currentSourceUrl = normalizeHttpsUrl(input.sourceUrl);
  const currentAsin = normalizeAsin(input.asin);
  const reviewedRetailer = typeof sourceIdentity.retailer === "string"
    ? sourceIdentity.retailer.trim().toLowerCase()
    : "";
  const reviewedSourceUrl = typeof sourceIdentity.sourceUrl === "string"
    ? normalizeHttpsUrl(sourceIdentity.sourceUrl)
    : null;
  const reviewedAsin = typeof sourceIdentity.asin === "string"
    ? normalizeAsin(sourceIdentity.asin)
    : sourceIdentity.asin === null
      ? null
      : "__invalid__";

  if (!currentRetailer || !currentSourceUrl || !reviewedRetailer || !reviewedSourceUrl || reviewedAsin === "__invalid__") {
    return result(false, "SOURCE_IDENTITY_INVALID");
  }
  if (currentRetailer === "amazon" && (!currentAsin || !/^[A-Z0-9]{10}$/.test(currentAsin))) {
    return result(false, "SOURCE_IDENTITY_INVALID");
  }
  if (
    currentRetailer !== reviewedRetailer ||
    currentSourceUrl !== reviewedSourceUrl ||
    currentAsin !== reviewedAsin
  ) {
    return result(false, "SOURCE_IDENTITY_DRIFT");
  }

  return result(true, "SOURCE_BOUND", currentRetailer, currentSourceUrl, currentAsin);
}
