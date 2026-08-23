export type PricingInput = {
  landedCostCents: number;
  targetGrossMarginBps: number;
  minimumProfitCents?: number;
  paymentFeeBps?: number;
  paymentFixedFeeCents?: number;
  priceFloorCents?: number;
  priceCeilingCents?: number;
};

export type PricingQuote = {
  eligible: boolean;
  reason: "OK" | "INVALID_INPUT" | "UNATTAINABLE_MARGIN" | "PRICE_CAP_EXCEEDED";
  sellingPriceCents: number | null;
  estimatedPaymentFeeCents: number | null;
  estimatedProfitCents: number | null;
  grossMarginBps: number | null;
};

function isNonNegativeInteger(value: number) {
  return Number.isInteger(value) && value >= 0;
}

function ceilMulBps(cents: number, bps: number) {
  return Math.ceil((cents * bps) / 10_000);
}

export function quoteSellingPrice(input: PricingInput): PricingQuote {
  const minimumProfitCents = input.minimumProfitCents ?? 0;
  const paymentFeeBps = input.paymentFeeBps ?? 0;
  const paymentFixedFeeCents = input.paymentFixedFeeCents ?? 0;
  const priceFloorCents = input.priceFloorCents ?? 0;
  const priceCeilingCents = input.priceCeilingCents ?? Number.MAX_SAFE_INTEGER;

  const integerFields = [
    input.landedCostCents,
    input.targetGrossMarginBps,
    minimumProfitCents,
    paymentFeeBps,
    paymentFixedFeeCents,
    priceFloorCents,
    priceCeilingCents,
  ];

  if (!integerFields.every(isNonNegativeInteger) || input.landedCostCents === 0 || priceCeilingCents < priceFloorCents) {
    return { eligible: false, reason: "INVALID_INPUT", sellingPriceCents: null, estimatedPaymentFeeCents: null, estimatedProfitCents: null, grossMarginBps: null };
  }

  if (input.targetGrossMarginBps + paymentFeeBps >= 10_000) {
    return { eligible: false, reason: "UNATTAINABLE_MARGIN", sellingPriceCents: null, estimatedPaymentFeeCents: null, estimatedProfitCents: null, grossMarginBps: null };
  }

  const marginDenominator = 10_000 - input.targetGrossMarginBps - paymentFeeBps;
  const marginPrice = Math.ceil(((input.landedCostCents + paymentFixedFeeCents) * 10_000) / marginDenominator);
  const profitDenominator = 10_000 - paymentFeeBps;
  const profitPrice = Math.ceil(((input.landedCostCents + paymentFixedFeeCents + minimumProfitCents) * 10_000) / profitDenominator);

  let sellingPriceCents = Math.max(marginPrice, profitPrice, priceFloorCents);

  // Exact verification accounts for rounding of percentage-based processor fees.
  for (let i = 0; i < 16; i += 1) {
    const fee = paymentFixedFeeCents + ceilMulBps(sellingPriceCents, paymentFeeBps);
    const profit = sellingPriceCents - input.landedCostCents - fee;
    const grossMarginBps = Math.floor((profit * 10_000) / sellingPriceCents);
    if (profit >= minimumProfitCents && grossMarginBps >= input.targetGrossMarginBps) break;
    sellingPriceCents += 1;
  }

  if (sellingPriceCents > priceCeilingCents) {
    return { eligible: false, reason: "PRICE_CAP_EXCEEDED", sellingPriceCents: null, estimatedPaymentFeeCents: null, estimatedProfitCents: null, grossMarginBps: null };
  }

  const estimatedPaymentFeeCents = paymentFixedFeeCents + ceilMulBps(sellingPriceCents, paymentFeeBps);
  const estimatedProfitCents = sellingPriceCents - input.landedCostCents - estimatedPaymentFeeCents;
  const grossMarginBps = Math.floor((estimatedProfitCents * 10_000) / sellingPriceCents);

  return {
    eligible: true,
    reason: "OK",
    sellingPriceCents,
    estimatedPaymentFeeCents,
    estimatedProfitCents,
    grossMarginBps,
  };
}
