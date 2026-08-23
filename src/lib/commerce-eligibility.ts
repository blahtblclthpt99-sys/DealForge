import { calculateLandedCost, type LandedCostInput } from "@/lib/landed-cost";
import { quoteSellingPrice, type PricingInput, type PricingQuote } from "@/lib/dynamic-pricing";

export type CommerceEligibilityReason =
  | "ELIGIBLE"
  | "BLOCKED_FINANCIAL_GATE"
  | "BLOCKED_UNVERIFIED_SOURCE"
  | "BLOCKED_UNAVAILABLE"
  | "BLOCKED_STALE_SOURCE"
  | "BLOCKED_INVALID_COST"
  | "BLOCKED_MARGIN"
  | "BLOCKED_PRICE_CAP"
  | "BLOCKED_INVALID_PRICING";

export type ProfitabilityTier = "blocked" | "thin" | "healthy" | "strong";

export type CommerceEligibilityInput = {
  financialGateCertified: boolean;
  landedCost: LandedCostInput;
  pricing: Omit<PricingInput, "landedCostCents">;
};

export type CommerceEligibilityResult = {
  eligible: boolean;
  reason: CommerceEligibilityReason;
  landedCostCents: number | null;
  recommendedSellingPriceCents: number | null;
  estimatedPaymentFeeCents: number | null;
  estimatedProfitCents: number | null;
  grossMarginBps: number | null;
  profitabilityScore: number | null;
  profitabilityTier: ProfitabilityTier;
  pricingQuote: PricingQuote | null;
};

const BIGINT_ZERO = BigInt(0);
const BIGINT_TWENTY = BigInt(20);
const BIGINT_BPS_SCALE = BigInt(10_000);

function blocked(reason: CommerceEligibilityReason, landedCostCents: number | null = null, pricingQuote: PricingQuote | null = null): CommerceEligibilityResult {
  return {
    eligible: false,
    reason,
    landedCostCents,
    recommendedSellingPriceCents: null,
    estimatedPaymentFeeCents: null,
    estimatedProfitCents: null,
    grossMarginBps: null,
    profitabilityScore: null,
    profitabilityTier: "blocked",
    pricingQuote,
  };
}

function clampInt(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function sourceFreshnessPoints(input: LandedCostInput) {
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(input.sourceCheckedAtMs) || !Number.isSafeInteger(input.maxSourceAgeMs) || input.maxSourceAgeMs <= 0) {
    return 0;
  }
  const ageMs = Math.max(0, nowMs - input.sourceCheckedAtMs);
  if (ageMs >= input.maxSourceAgeMs) return 0;
  const remaining = input.maxSourceAgeMs - ageMs;
  const points = (BigInt(remaining) * BIGINT_TWENTY) / BigInt(input.maxSourceAgeMs);
  return clampInt(Number(points), 0, 20);
}

function roiBps(profitCents: number, landedCostCents: number) {
  if (profitCents <= 0 || landedCostCents <= 0) return 0;
  const value = (BigInt(profitCents) * BIGINT_BPS_SCALE) / BigInt(landedCostCents);
  if (value <= BIGINT_ZERO) return 0;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  return Number(value);
}

function profitabilityScore(quote: PricingQuote, landedCostCents: number, landedCostInput: LandedCostInput) {
  const marginBps = quote.grossMarginBps ?? 0;
  const profitCents = quote.estimatedProfitCents ?? 0;

  // 50 points: gross-margin quality, maxed at 50% margin.
  const marginPoints = clampInt(Math.floor(marginBps / 100), 0, 50);

  // 30 points: return on landed cost, maxed at 60% ROI.
  const returnPoints = clampInt(Math.floor(roiBps(profitCents, landedCostCents) / 200), 0, 30);

  // 20 points: freshness remaining inside the source verification window.
  const freshnessPoints = sourceFreshnessPoints(landedCostInput);

  return clampInt(marginPoints + returnPoints + freshnessPoints, 0, 100);
}

function tierForScore(score: number): ProfitabilityTier {
  if (score >= 75) return "strong";
  if (score >= 55) return "healthy";
  return "thin";
}

function landedCostReason(reason: ReturnType<typeof calculateLandedCost>["reason"]): CommerceEligibilityReason {
  switch (reason) {
    case "SOURCE_UNVERIFIED":
      return "BLOCKED_UNVERIFIED_SOURCE";
    case "SOURCE_UNAVAILABLE":
      return "BLOCKED_UNAVAILABLE";
    case "SOURCE_STALE":
      return "BLOCKED_STALE_SOURCE";
    case "INVALID_INPUT":
    default:
      return "BLOCKED_INVALID_COST";
  }
}

function pricingReason(reason: PricingQuote["reason"]): CommerceEligibilityReason {
  switch (reason) {
    case "PRICE_CAP_EXCEEDED":
      return "BLOCKED_PRICE_CAP";
    case "UNATTAINABLE_MARGIN":
      return "BLOCKED_MARGIN";
    case "INVALID_INPUT":
    default:
      return "BLOCKED_INVALID_PRICING";
  }
}

export function assessCommerceEligibility(input: CommerceEligibilityInput): CommerceEligibilityResult {
  if (!input.financialGateCertified) {
    return blocked("BLOCKED_FINANCIAL_GATE");
  }

  const landed = calculateLandedCost(input.landedCost);
  if (!landed.eligible || landed.landedCostCents === null) {
    return blocked(landedCostReason(landed.reason));
  }

  const pricingQuote = quoteSellingPrice({
    ...input.pricing,
    landedCostCents: landed.landedCostCents,
  });

  if (!pricingQuote.eligible || pricingQuote.sellingPriceCents === null) {
    return blocked(pricingReason(pricingQuote.reason), landed.landedCostCents, pricingQuote);
  }

  const score = profitabilityScore(pricingQuote, landed.landedCostCents, input.landedCost);

  return {
    eligible: true,
    reason: "ELIGIBLE",
    landedCostCents: landed.landedCostCents,
    recommendedSellingPriceCents: pricingQuote.sellingPriceCents,
    estimatedPaymentFeeCents: pricingQuote.estimatedPaymentFeeCents,
    estimatedProfitCents: pricingQuote.estimatedProfitCents,
    grossMarginBps: pricingQuote.grossMarginBps,
    profitabilityScore: score,
    profitabilityTier: tierForScore(score),
    pricingQuote,
  };
}
