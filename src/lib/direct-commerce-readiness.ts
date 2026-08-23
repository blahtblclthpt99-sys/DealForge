export type DirectCommerceReadinessReason =
  | "READY"
  | "BLOCKED_FINANCIAL_GATE"
  | "COMMERCE_DISABLED"
  | "ALREADY_ACTIVE"
  | "UNAVAILABLE"
  | "INVALID_CURRENCY"
  | "INVALID_FINANCIALS"
  | "MISSING_RECOMMENDATION"
  | "INVALID_RECOMMENDATION"
  | "SOURCE_UNVERIFIED"
  | "SOURCE_UNAVAILABLE"
  | "SOURCE_STALE"
  | "FINANCIAL_DRIFT";

export type DirectCommerceReadinessInput = {
  financialGateCertified: boolean;
  commerceEnabled: boolean;
  availability: string;
  currency: string;
  landedCostCents: number | null;
  sellingPriceCents: number | null;
  specifications: unknown;
  nowMs?: number;
};

export type DirectCommerceReadinessResult = {
  ready: boolean;
  reason: DirectCommerceReadinessReason;
  sourceCheckedAtMs: number | null;
  sourceAgeMs: number | null;
  maxSourceAgeMs: number | null;
};

function blocked(reason: DirectCommerceReadinessReason): DirectCommerceReadinessResult {
  return {
    ready: false,
    reason,
    sourceCheckedAtMs: null,
    sourceAgeMs: null,
    maxSourceAgeMs: null,
  };
}

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

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isoTime(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function validateFinancialAndSourceState(
  input: DirectCommerceReadinessInput,
): DirectCommerceReadinessResult {
  const nowMs = input.nowMs ?? Date.now();

  if (!input.financialGateCertified) return blocked("BLOCKED_FINANCIAL_GATE");
  if (input.availability !== "in_stock") return blocked("UNAVAILABLE");
  if (input.currency.trim().toLowerCase() !== "usd") return blocked("INVALID_CURRENCY");
  if (!positiveSafeInteger(input.landedCostCents) || !positiveSafeInteger(input.sellingPriceCents)) {
    return blocked("INVALID_FINANCIALS");
  }
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) return blocked("INVALID_RECOMMENDATION");

  const specifications = parseSpecifications(input.specifications);
  if (!specifications) return blocked("MISSING_RECOMMENDATION");

  const recommendation = record(specifications.commerceRecommendation);
  if (!recommendation) return blocked("MISSING_RECOMMENDATION");
  if (recommendation.status !== "owner_reviewed_recommendation") {
    return blocked("INVALID_RECOMMENDATION");
  }
  if (recommendation.sourceVerified !== true) return blocked("SOURCE_UNVERIFIED");
  if (recommendation.sourceAvailable !== true) return blocked("SOURCE_UNAVAILABLE");

  const sourceCheckedAtMs = isoTime(recommendation.sourceCheckedAt);
  const assessedAtMs = isoTime(recommendation.assessedAt);
  const maxSourceAgeMs = recommendation.maxSourceAgeMs;
  if (
    sourceCheckedAtMs === null ||
    assessedAtMs === null ||
    !positiveSafeInteger(maxSourceAgeMs) ||
    sourceCheckedAtMs > assessedAtMs ||
    assessedAtMs > nowMs ||
    sourceCheckedAtMs > nowMs
  ) {
    return blocked("INVALID_RECOMMENDATION");
  }

  const sourceAgeMs = nowMs - sourceCheckedAtMs;
  if (!Number.isSafeInteger(sourceAgeMs) || sourceAgeMs < 0) {
    return blocked("INVALID_RECOMMENDATION");
  }
  if (sourceAgeMs > maxSourceAgeMs) {
    return {
      ready: false,
      reason: "SOURCE_STALE",
      sourceCheckedAtMs,
      sourceAgeMs,
      maxSourceAgeMs,
    };
  }

  const result = record(recommendation.result);
  if (!result) return blocked("INVALID_RECOMMENDATION");
  if (
    !positiveSafeInteger(result.landedCostCents) ||
    !positiveSafeInteger(result.recommendedSellingPriceCents)
  ) {
    return blocked("INVALID_RECOMMENDATION");
  }
  if (
    result.landedCostCents !== input.landedCostCents ||
    result.recommendedSellingPriceCents !== input.sellingPriceCents
  ) {
    return blocked("FINANCIAL_DRIFT");
  }

  return {
    ready: true,
    reason: "READY",
    sourceCheckedAtMs,
    sourceAgeMs,
    maxSourceAgeMs,
  };
}

export function checkDirectCommerceReadiness(
  input: DirectCommerceReadinessInput,
): DirectCommerceReadinessResult {
  if (!input.commerceEnabled) return blocked("COMMERCE_DISABLED");
  return validateFinancialAndSourceState(input);
}

export function checkDirectCommerceActivationReadiness(
  input: DirectCommerceReadinessInput,
): DirectCommerceReadinessResult {
  if (input.commerceEnabled) return blocked("ALREADY_ACTIVE");
  return validateFinancialAndSourceState(input);
}
