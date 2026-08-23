import { checkRecommendationSourceBinding } from "./commerce-source-binding";
import {
  checkDirectCommerceActivationReadiness,
  type DirectCommerceReadinessReason,
} from "./direct-commerce-readiness";

export type CommerceOpportunityInput = {
  id: string;
  title: string;
  financialGateCertified: boolean;
  commerceEnabled: boolean;
  availability: string;
  currency: string;
  landedCostCents: number | null;
  sellingPriceCents: number | null;
  specifications: unknown;
  retailer: string;
  sourceUrl: string;
  asin: string | null;
  clickCount: number;
  viewCount: number;
  nowMs?: number;
};

export type CommerceOpportunityReadinessReason =
  | DirectCommerceReadinessReason
  | "SOURCE_IDENTITY_MISSING"
  | "SOURCE_IDENTITY_INVALID"
  | "SOURCE_IDENTITY_DRIFT";

export type CommerceOpportunity = {
  id: string;
  title: string;
  readyForOwnerActivation: boolean;
  readinessReason: CommerceOpportunityReadinessReason;
  profitabilityTier: "strong" | "healthy" | "thin" | "blocked";
  profitabilityScore: number | null;
  estimatedProfitCents: number | null;
  grossMarginBps: number | null;
  landedCostCents: number | null;
  sellingPriceCents: number | null;
  sourceAgeMs: number | null;
  sourceFreshnessRemainingMs: number | null;
  clickCount: number;
  viewCount: number;
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function specifications(value: unknown) {
  if (typeof value !== "string") return record(value);
  try {
    return record(JSON.parse(value));
  } catch {
    return null;
  }
}

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function tier(value: unknown): CommerceOpportunity["profitabilityTier"] {
  return value === "strong" || value === "healthy" || value === "thin" ? value : "blocked";
}

export function evaluateCommerceOpportunity(input: CommerceOpportunityInput): CommerceOpportunity {
  const readiness = checkDirectCommerceActivationReadiness({
    financialGateCertified: input.financialGateCertified,
    commerceEnabled: input.commerceEnabled,
    availability: input.availability,
    currency: input.currency,
    landedCostCents: input.landedCostCents,
    sellingPriceCents: input.sellingPriceCents,
    specifications: input.specifications,
    nowMs: input.nowMs,
  });
  const binding = readiness.ready
    ? checkRecommendationSourceBinding({
        retailer: input.retailer,
        sourceUrl: input.sourceUrl,
        asin: input.asin,
        specifications: input.specifications,
      })
    : null;
  const specs = specifications(input.specifications);
  const recommendation = specs ? record(specs.commerceRecommendation) : null;
  const result = recommendation ? record(recommendation.result) : null;
  const sourceFreshnessRemainingMs = readiness.sourceAgeMs != null && readiness.maxSourceAgeMs != null
    ? Math.max(0, readiness.maxSourceAgeMs - readiness.sourceAgeMs)
    : null;
  const readyForOwnerActivation = readiness.ready && binding?.bound === true;
  let readinessReason: CommerceOpportunityReadinessReason = readiness.reason;
  if (readiness.ready) {
    if (binding?.bound) readinessReason = "READY";
    else if (binding && binding.reason !== "SOURCE_BOUND") readinessReason = binding.reason;
    else readinessReason = "SOURCE_IDENTITY_MISSING";
  }

  return {
    id: input.id,
    title: input.title,
    readyForOwnerActivation,
    readinessReason,
    profitabilityTier: tier(result?.profitabilityTier),
    profitabilityScore: safeNumber(result?.profitabilityScore),
    estimatedProfitCents: safeNumber(result?.estimatedProfitCents),
    grossMarginBps: safeNumber(result?.grossMarginBps),
    landedCostCents: input.landedCostCents,
    sellingPriceCents: input.sellingPriceCents,
    sourceAgeMs: readiness.sourceAgeMs,
    sourceFreshnessRemainingMs,
    clickCount: Number.isSafeInteger(input.clickCount) && input.clickCount >= 0 ? input.clickCount : 0,
    viewCount: Number.isSafeInteger(input.viewCount) && input.viewCount >= 0 ? input.viewCount : 0,
  };
}

const TIER_RANK: Record<CommerceOpportunity["profitabilityTier"], number> = {
  strong: 3,
  healthy: 2,
  thin: 1,
  blocked: 0,
};

function descendingNullable(left: number | null, right: number | null) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return right - left;
}

export function compareCommerceOpportunities(left: CommerceOpportunity, right: CommerceOpportunity) {
  if (left.readyForOwnerActivation !== right.readyForOwnerActivation) {
    return left.readyForOwnerActivation ? -1 : 1;
  }
  const tierDifference = TIER_RANK[right.profitabilityTier] - TIER_RANK[left.profitabilityTier];
  if (tierDifference) return tierDifference;
  const scoreDifference = descendingNullable(left.profitabilityScore, right.profitabilityScore);
  if (scoreDifference) return scoreDifference;
  const profitDifference = descendingNullable(left.estimatedProfitCents, right.estimatedProfitCents);
  if (profitDifference) return profitDifference;
  const marginDifference = descendingNullable(left.grossMarginBps, right.grossMarginBps);
  if (marginDifference) return marginDifference;
  const freshnessDifference = descendingNullable(left.sourceFreshnessRemainingMs, right.sourceFreshnessRemainingMs);
  if (freshnessDifference) return freshnessDifference;
  return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
}

export function rankCommerceOpportunities(rows: CommerceOpportunity[]) {
  return [...rows].sort(compareCommerceOpportunities);
}
