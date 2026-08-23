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

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function isNonNegativeSafeInteger(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

function ceilDiv(numerator: bigint, denominator: bigint) {
  return (numerator + denominator - 1n) / denominator;
}

function safeNumber(value: bigint) {
  if (value < 0n || value > MAX_SAFE_BIGINT) return null;
  return Number(value);
}

function paymentFeeCents(priceCents: number, feeBps: number, fixedFeeCents: number) {
  const variable = ceilDiv(BigInt(priceCents) * BigInt(feeBps), 10_000n);
  return safeNumber(BigInt(fixedFeeCents) + variable);
}

function grossMarginBps(profitCents: number, sellingPriceCents: number) {
  if (profitCents < 0 || sellingPriceCents <= 0) return -1;
  return Number((BigInt(profitCents) * 10_000n) / BigInt(sellingPriceCents));
}

function invalidQuote(reason: PricingQuote["reason"]): PricingQuote {
  return {
    eligible: false,
    reason,
    sellingPriceCents: null,
    estimatedPaymentFeeCents: null,
    estimatedProfitCents: null,
    grossMarginBps: null,
  };
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

  if (!integerFields.every(isNonNegativeSafeInteger) || input.landedCostCents === 0 || priceCeilingCents < priceFloorCents) {
    return invalidQuote("INVALID_INPUT");
  }

  if (input.targetGrossMarginBps + paymentFeeBps >= 10_000) {
    return invalidQuote("UNATTAINABLE_MARGIN");
  }

  const marginDenominator = BigInt(10_000 - input.targetGrossMarginBps - paymentFeeBps);
  const marginBase = BigInt(input.landedCostCents) + BigInt(paymentFixedFeeCents);
  const marginPrice = safeNumber(ceilDiv(marginBase * 10_000n, marginDenominator));

  const profitDenominator = BigInt(10_000 - paymentFeeBps);
  const profitBase = BigInt(input.landedCostCents) + BigInt(paymentFixedFeeCents) + BigInt(minimumProfitCents);
  const profitPrice = safeNumber(ceilDiv(profitBase * 10_000n, profitDenominator));

  if (marginPrice === null || profitPrice === null) return invalidQuote("INVALID_INPUT");

  let sellingPriceCents = Math.max(marginPrice, profitPrice, priceFloorCents);

  // Exact verification accounts for processor-fee rounding without ever using
  // floating-point money as the financial source of truth.
  for (let i = 0; i < 16; i += 1) {
    if (!Number.isSafeInteger(sellingPriceCents)) return invalidQuote("INVALID_INPUT");
    const fee = paymentFeeCents(sellingPriceCents, paymentFeeBps, paymentFixedFeeCents);
    if (fee === null) return invalidQuote("INVALID_INPUT");
    const profit = sellingPriceCents - input.landedCostCents - fee;
    const margin = grossMarginBps(profit, sellingPriceCents);
    if (profit >= minimumProfitCents && margin >= input.targetGrossMarginBps) break;
    sellingPriceCents += 1;
  }

  if (!Number.isSafeInteger(sellingPriceCents)) return invalidQuote("INVALID_INPUT");
  if (sellingPriceCents > priceCeilingCents) return invalidQuote("PRICE_CAP_EXCEEDED");

  const estimatedPaymentFeeCents = paymentFeeCents(sellingPriceCents, paymentFeeBps, paymentFixedFeeCents);
  if (estimatedPaymentFeeCents === null) return invalidQuote("INVALID_INPUT");
  const estimatedProfitCents = sellingPriceCents - input.landedCostCents - estimatedPaymentFeeCents;
  const margin = grossMarginBps(estimatedProfitCents, sellingPriceCents);

  if (estimatedProfitCents < minimumProfitCents || margin < input.targetGrossMarginBps) {
    return invalidQuote("INVALID_INPUT");
  }

  return {
    eligible: true,
    reason: "OK",
    sellingPriceCents,
    estimatedPaymentFeeCents,
    estimatedProfitCents,
    grossMarginBps: margin,
  };
}
