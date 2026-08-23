export type LandedCostInput = {
  itemCostCents: number;
  shippingCents: number;
  estimatedTaxCents: number;
  handlingCents: number;
  procurementBufferCents: number;
  otherCostCents: number;
  sourceVerified: boolean;
  sourceAvailable: boolean;
  sourceCheckedAtMs: number;
  maxSourceAgeMs: number;
  nowMs?: number;
};

export type LandedCostResult = {
  eligible: boolean;
  reason: "OK" | "INVALID_INPUT" | "SOURCE_UNVERIFIED" | "SOURCE_UNAVAILABLE" | "SOURCE_STALE";
  landedCostCents: number | null;
};

function nonNegativeSafeInteger(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function calculateLandedCost(input: LandedCostInput): LandedCostResult {
  const nowMs = input.nowMs ?? Date.now();
  const costs = [
    input.itemCostCents,
    input.shippingCents,
    input.estimatedTaxCents,
    input.handlingCents,
    input.procurementBufferCents,
    input.otherCostCents,
  ];

  if (
    !costs.every(nonNegativeSafeInteger) ||
    input.itemCostCents <= 0 ||
    !Number.isSafeInteger(input.sourceCheckedAtMs) ||
    input.sourceCheckedAtMs <= 0 ||
    !Number.isSafeInteger(input.maxSourceAgeMs) ||
    input.maxSourceAgeMs <= 0 ||
    !Number.isSafeInteger(nowMs) ||
    nowMs < input.sourceCheckedAtMs
  ) {
    return { eligible: false, reason: "INVALID_INPUT", landedCostCents: null };
  }

  if (!input.sourceVerified) {
    return { eligible: false, reason: "SOURCE_UNVERIFIED", landedCostCents: null };
  }

  if (!input.sourceAvailable) {
    return { eligible: false, reason: "SOURCE_UNAVAILABLE", landedCostCents: null };
  }

  if (nowMs - input.sourceCheckedAtMs > input.maxSourceAgeMs) {
    return { eligible: false, reason: "SOURCE_STALE", landedCostCents: null };
  }

  const landedCostCents = costs.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(landedCostCents) || landedCostCents <= 0) {
    return { eligible: false, reason: "INVALID_INPUT", landedCostCents: null };
  }

  return { eligible: true, reason: "OK", landedCostCents };
}
