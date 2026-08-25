export type MinimumProfitTier = {
  maxLandedCostCents: number | null;
  fixedProfitCents: number;
  percentageBps: number;
};

export const MINIMUM_SAFE_PROFIT_TIERS: readonly MinimumProfitTier[] = [
  { maxLandedCostCents: 1_000, fixedProfitCents: 200, percentageBps: 1_800 },
  { maxLandedCostCents: 2_000, fixedProfitCents: 250, percentageBps: 1_500 },
  { maxLandedCostCents: 4_000, fixedProfitCents: 350, percentageBps: 1_200 },
  { maxLandedCostCents: 7_500, fixedProfitCents: 500, percentageBps: 1_000 },
  { maxLandedCostCents: 15_000, fixedProfitCents: 750, percentageBps: 800 },
  { maxLandedCostCents: 30_000, fixedProfitCents: 1_200, percentageBps: 600 },
  { maxLandedCostCents: 50_000, fixedProfitCents: 1_800, percentageBps: 500 },
  { maxLandedCostCents: null, fixedProfitCents: 2_500, percentageBps: 400 },
] as const;

export const MAX_MONTHLY_LOSS_RESERVE_BPS = 200;
export const DEFAULT_MONTHLY_LOSS_RESERVE_BPS = 100;
export const DEFAULT_PAYMENT_RATE_BPS = 350;
export const DEFAULT_PAYMENT_FIXED_CENTS = 30;

export type CartPricingPolicy = {
  paymentRateBps: number;
  paymentFixedCents: number;
  lossReserveBps: number;
};

export type CartPricingDecision = {
  eligible: boolean;
  customerPriceCents: number;
  minimumSafePriceCents: number;
  minimumProfitCents: number;
  estimatedPaymentCostCents: number;
  estimatedLossReserveCents: number;
  estimatedContributionProfitCents: number;
  publishedPriceCents: number;
  savingsCents: number;
  savingsPercent: number;
  reason: string | null;
};

function positiveInt(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field.toUpperCase()}_INVALID`);
  return value;
}

function envInt(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
}

export function currentCartPricingPolicy(): CartPricingPolicy {
  return {
    paymentRateBps: envInt("DEALFORGE_PAYMENT_RATE_BPS", DEFAULT_PAYMENT_RATE_BPS, 0, 1_500),
    paymentFixedCents: envInt("DEALFORGE_PAYMENT_FIXED_CENTS", DEFAULT_PAYMENT_FIXED_CENTS, 0, 500),
    lossReserveBps: Math.min(
      MAX_MONTHLY_LOSS_RESERVE_BPS,
      envInt(
        "DEALFORGE_LOSS_RESERVE_BPS",
        DEFAULT_MONTHLY_LOSS_RESERVE_BPS,
        0,
        MAX_MONTHLY_LOSS_RESERVE_BPS,
      ),
    ),
  };
}

export function minimumSafeProfitCents(landedCostCents: number) {
  const landed = positiveInt(landedCostCents, "landed_cost_cents");
  const tier = MINIMUM_SAFE_PROFIT_TIERS.find(
    (candidate) => candidate.maxLandedCostCents === null || landed <= candidate.maxLandedCostCents,
  );
  if (!tier) throw new Error("PROFIT_TIER_NOT_FOUND");
  return Math.max(tier.fixedProfitCents, Math.ceil((landed * tier.percentageBps) / 10_000));
}

/**
 * Rounds only upward to the nearest approved customer-friendly ending (.49 or .99).
 * The rounding increment can never exceed 49 cents.
 */
export function roundToFriendlyPrice(priceCents: number) {
  const price = positiveInt(priceCents, "price_cents");
  const dollars = Math.floor(price / 100);
  const fortyNine = dollars * 100 + 49;
  if (fortyNine >= price) return fortyNine;
  const ninetyNine = dollars * 100 + 99;
  if (ninetyNine >= price) return ninetyNine;
  return (dollars + 1) * 100 + 49;
}

/**
 * Canonical DealForge cart-price decision.
 *
 * The catalog price is a ceiling, not the checkout authority. When an item enters
 * the cart, DealForge recalculates the lowest customer-friendly price that covers
 * true landed cost, one payment-cost allowance, the current monthly pooled loss
 * reserve, and the tiered minimum safe contribution profit.
 *
 * If the recalculated safe price is above the published price, the product is
 * blocked rather than surprising the customer with a higher cart price.
 */
export function calculateCustomerFriendlyPrice(input: {
  landedCostCents: number;
  publishedPriceCents: number;
  policy?: CartPricingPolicy;
}): CartPricingDecision {
  const landedCostCents = positiveInt(input.landedCostCents, "landed_cost_cents");
  const publishedPriceCents = positiveInt(input.publishedPriceCents, "published_price_cents");
  const policy = input.policy ?? currentCartPricingPolicy();

  if (
    !Number.isSafeInteger(policy.paymentRateBps) ||
    policy.paymentRateBps < 0 ||
    policy.paymentRateBps >= 10_000 ||
    !Number.isSafeInteger(policy.paymentFixedCents) ||
    policy.paymentFixedCents < 0 ||
    !Number.isSafeInteger(policy.lossReserveBps) ||
    policy.lossReserveBps < 0 ||
    policy.lossReserveBps > MAX_MONTHLY_LOSS_RESERVE_BPS ||
    policy.paymentRateBps + policy.lossReserveBps >= 10_000
  ) {
    throw new Error("CART_PRICING_POLICY_INVALID");
  }

  const minimumProfitCents = minimumSafeProfitCents(landedCostCents);
  const denominatorBps = 10_000 - policy.paymentRateBps - policy.lossReserveBps;
  const minimumSafePriceCents = Math.ceil(
    ((landedCostCents + minimumProfitCents + policy.paymentFixedCents) * 10_000) / denominatorBps,
  );
  const customerPriceCents = roundToFriendlyPrice(minimumSafePriceCents);
  const estimatedPaymentCostCents =
    Math.ceil((customerPriceCents * policy.paymentRateBps) / 10_000) + policy.paymentFixedCents;
  const estimatedLossReserveCents = Math.ceil((customerPriceCents * policy.lossReserveBps) / 10_000);
  const estimatedContributionProfitCents =
    customerPriceCents - landedCostCents - estimatedPaymentCostCents - estimatedLossReserveCents;

  const safe = estimatedContributionProfitCents >= minimumProfitCents;
  const underPublishedCeiling = customerPriceCents <= publishedPriceCents;
  const eligible = safe && underPublishedCeiling;
  const savingsCents = eligible ? Math.max(0, publishedPriceCents - customerPriceCents) : 0;
  const savingsPercent =
    savingsCents > 0 ? Math.round((savingsCents / publishedPriceCents) * 10_000) / 100 : 0;

  return {
    eligible,
    customerPriceCents,
    minimumSafePriceCents,
    minimumProfitCents,
    estimatedPaymentCostCents,
    estimatedLossReserveCents,
    estimatedContributionProfitCents,
    publishedPriceCents,
    savingsCents,
    savingsPercent,
    reason: !safe ? "MINIMUM_SAFE_PROFIT_NOT_MET" : !underPublishedCeiling ? "PUBLISHED_PRICE_NO_LONGER_SAFE" : null,
  };
}
