export const SAVINGS_FUND_POLICY_VERSION = "csf-v1-phase-a";
export const SAVINGS_FUND_MODE = "dry_run" as const;

export const DEFAULT_PROFIT_REINVESTMENT_BPS = 1_000; // 10% of certified realized contribution.
export const MAX_PROFIT_REINVESTMENT_BPS = 2_500;
export const MAX_CART_SAVINGS_BPS = 500; // 5% of the cart.
export const MAX_ORDER_PROFIT_REDUCTION_BPS = 2_500; // Preserve at least 75% of current-order contribution.
export const MIN_DRY_RUN_SAVINGS_CENTS = 50;
export const MAX_DRY_RUN_SAVINGS_CENTS = 500;

function safeInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value)) throw new Error(`${field.toUpperCase()}_INVALID`);
  return value;
}

function safeNonNegativeInteger(value: number, field: string) {
  const parsed = safeInteger(value, field);
  if (parsed < 0) throw new Error(`${field.toUpperCase()}_INVALID`);
  return parsed;
}

function basisPoints(value: number, field: string, max = 10_000) {
  const parsed = safeNonNegativeInteger(value, field);
  if (parsed > max) throw new Error(`${field.toUpperCase()}_INVALID`);
  return parsed;
}

function percentageFloor(amountCents: number, bps: number) {
  return Math.floor((amountCents * bps) / 10_000);
}

export function currentSavingsFundPolicy() {
  const configured = Number.parseInt(process.env.DEALFORGE_SAVINGS_FUND_REINVESTMENT_BPS || "", 10);
  const profitReinvestmentBps = Number.isSafeInteger(configured)
    ? Math.min(MAX_PROFIT_REINVESTMENT_BPS, Math.max(0, configured))
    : DEFAULT_PROFIT_REINVESTMENT_BPS;

  return {
    version: SAVINGS_FUND_POLICY_VERSION,
    mode: SAVINGS_FUND_MODE,
    profitReinvestmentBps,
    maxCartSavingsBps: MAX_CART_SAVINGS_BPS,
    maxOrderProfitReductionBps: MAX_ORDER_PROFIT_REDUCTION_BPS,
    minDryRunSavingsCents: MIN_DRY_RUN_SAVINGS_CENTS,
    maxDryRunSavingsCents: MAX_DRY_RUN_SAVINGS_CENTS,
    appliesToCheckout: false,
  } as const;
}

/**
 * Phase A accrual is shadow accounting only. It never moves cash and is only
 * calculated from certified, realized order contribution.
 */
export function calculateSavingsFundAccrual(
  certifiedContributionCents: number,
  reinvestmentBps = currentSavingsFundPolicy().profitReinvestmentBps,
) {
  const contribution = safeInteger(certifiedContributionCents, "certified_contribution_cents");
  const rate = basisPoints(reinvestmentBps, "reinvestment_bps", MAX_PROFIT_REINVESTMENT_BPS);
  if (contribution <= 0 || rate === 0) return 0;
  return percentageFloor(contribution, rate);
}

export type SavingsFundDryRunDecision = {
  policyVersion: string;
  mode: typeof SAVINGS_FUND_MODE;
  appliesToCheckout: false;
  eligible: boolean;
  reason: string | null;
  availableFundCents: number;
  cartSubtotalCents: number;
  preSubsidyContributionCents: number;
  proposedSavingsCents: number;
  hypotheticalCustomerTotalCents: number;
  postSubsidyContributionCents: number;
  caps: {
    fundBalanceCents: number;
    cartPercentCents: number;
    orderProfitCents: number;
    hardPerOrderCents: number;
  };
};

/**
 * Measure-only savings decision. The result may be shown to operators or
 * collected as telemetry, but must never alter Checkout or Stripe amounts in
 * Phase A.
 */
export function calculateSavingsFundDryRun(input: {
  availableFundCents: number;
  cartSubtotalCents: number;
  preSubsidyContributionCents: number;
}): SavingsFundDryRunDecision {
  const policy = currentSavingsFundPolicy();
  const availableFundCents = safeNonNegativeInteger(input.availableFundCents, "available_fund_cents");
  const cartSubtotalCents = safeNonNegativeInteger(input.cartSubtotalCents, "cart_subtotal_cents");
  const preSubsidyContributionCents = safeInteger(
    input.preSubsidyContributionCents,
    "pre_subsidy_contribution_cents",
  );

  const cartPercentCents = percentageFloor(cartSubtotalCents, policy.maxCartSavingsBps);
  const orderProfitCents = preSubsidyContributionCents > 0
    ? percentageFloor(preSubsidyContributionCents, policy.maxOrderProfitReductionBps)
    : 0;
  const candidate = Math.min(
    availableFundCents,
    cartPercentCents,
    orderProfitCents,
    policy.maxDryRunSavingsCents,
  );

  let proposedSavingsCents = candidate;
  let reason: string | null = null;
  if (cartSubtotalCents <= 0) {
    proposedSavingsCents = 0;
    reason = "EMPTY_CART";
  } else if (preSubsidyContributionCents <= 0) {
    proposedSavingsCents = 0;
    reason = "NO_POSITIVE_ORDER_CONTRIBUTION";
  } else if (availableFundCents <= 0) {
    proposedSavingsCents = 0;
    reason = "NO_SHADOW_FUND_BALANCE";
  } else if (candidate < policy.minDryRunSavingsCents) {
    proposedSavingsCents = 0;
    reason = "BELOW_MINIMUM_RELEASE";
  }

  const hypotheticalCustomerTotalCents = Math.max(0, cartSubtotalCents - proposedSavingsCents);
  const postSubsidyContributionCents = preSubsidyContributionCents - proposedSavingsCents;
  if (postSubsidyContributionCents < 0) {
    throw new Error("SAVINGS_FUND_WOULD_CREATE_NEGATIVE_CONTRIBUTION");
  }

  return {
    policyVersion: policy.version,
    mode: policy.mode,
    appliesToCheckout: false,
    eligible: proposedSavingsCents > 0,
    reason,
    availableFundCents,
    cartSubtotalCents,
    preSubsidyContributionCents,
    proposedSavingsCents,
    hypotheticalCustomerTotalCents,
    postSubsidyContributionCents,
    caps: {
      fundBalanceCents: availableFundCents,
      cartPercentCents,
      orderProfitCents,
      hardPerOrderCents: policy.maxDryRunSavingsCents,
    },
  };
}
