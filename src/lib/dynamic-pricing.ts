export type DynamicPricingInput = {
  landedCostCents: number;
  reserveTotalCents: number;
  minContributionProfitCents: number;
  minContributionMarginBps: number;
  marketReferenceCents?: number | null;
  maxMarketPremiumBps?: number;
  psychologicalEndingCents?: number | null;
};

export type DynamicPricingDecision = {
  recommendedPriceCents: number;
  minimumSafePriceCents: number;
  contributionProfitCents: number;
  contributionMarginBps: number;
  marketCeilingCents: number | null;
  marketCompatible: boolean;
  reasons: string[];
};

function positiveInt(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field.toUpperCase()}_INVALID`);
  return value;
}

function nonNegativeInt(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field.toUpperCase()}_INVALID`);
  return value;
}

function basisPoints(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 10_000) {
    throw new Error(`${field.toUpperCase()}_INVALID`);
  }
  return value;
}

function priceForMargin(costAndReserves: number, marginBps: number) {
  if (marginBps === 0) return costAndReserves;
  return Math.ceil((costAndReserves * 10_000) / (10_000 - marginBps));
}

function applyPsychologicalEnding(priceCents: number, ending: number | null | undefined) {
  if (ending === null || ending === undefined) return priceCents;
  if (!Number.isSafeInteger(ending) || ending < 0 || ending > 99) {
    throw new Error("PSYCHOLOGICAL_ENDING_CENTS_INVALID");
  }
  const dollars = Math.floor(priceCents / 100);
  let candidate = dollars * 100 + ending;
  if (candidate < priceCents) candidate += 100;
  return candidate;
}

export function recommendSellingPrice(input: DynamicPricingInput): DynamicPricingDecision {
  const landedCostCents = positiveInt(input.landedCostCents, "landed_cost_cents");
  const reserveTotalCents = nonNegativeInt(input.reserveTotalCents, "reserve_total_cents");
  const minProfit = positiveInt(input.minContributionProfitCents, "min_contribution_profit_cents");
  const minMarginBps = basisPoints(input.minContributionMarginBps, "min_contribution_margin_bps");

  const baseCost = landedCostCents + reserveTotalCents;
  if (!Number.isSafeInteger(baseCost) || baseCost <= 0) throw new Error("PRICE_BASE_INVALID");

  const profitFloorPrice = baseCost + minProfit;
  const marginFloorPrice = priceForMargin(baseCost, minMarginBps);
  const minimumSafePriceCents = Math.max(profitFloorPrice, marginFloorPrice);
  const recommendedPriceCents = applyPsychologicalEnding(
    minimumSafePriceCents,
    input.psychologicalEndingCents ?? 99,
  );

  const contributionProfitCents = recommendedPriceCents - baseCost;
  const contributionMarginBps = Math.floor((contributionProfitCents * 10_000) / recommendedPriceCents);

  let marketCeilingCents: number | null = null;
  let marketCompatible = true;
  const reasons: string[] = [];

  if (input.marketReferenceCents !== null && input.marketReferenceCents !== undefined) {
    const marketReference = positiveInt(input.marketReferenceCents, "market_reference_cents");
    const maxPremiumBps = basisPoints(input.maxMarketPremiumBps ?? 1500, "max_market_premium_bps");
    marketCeilingCents = Math.floor((marketReference * (10_000 + maxPremiumBps)) / 10_000);
    if (recommendedPriceCents > marketCeilingCents) {
      marketCompatible = false;
      reasons.push("safe_price_exceeds_market_ceiling");
    }
  }

  if (contributionProfitCents < minProfit) reasons.push("profit_floor_not_met");
  if (contributionMarginBps < minMarginBps) reasons.push("margin_floor_not_met");

  return {
    recommendedPriceCents,
    minimumSafePriceCents,
    contributionProfitCents,
    contributionMarginBps,
    marketCeilingCents,
    marketCompatible,
    reasons,
  };
}
