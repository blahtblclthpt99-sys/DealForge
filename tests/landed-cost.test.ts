import assert from "node:assert/strict";
import test from "node:test";
import { calculateLandedCost } from "../src/lib/landed-cost";

const NOW = 1_787_448_000_000;

function baseInput() {
  return {
    itemCostCents: 1_000,
    shippingCents: 125,
    estimatedTaxCents: 90,
    handlingCents: 35,
    procurementBufferCents: 50,
    otherCostCents: 0,
    sourceVerified: true,
    sourceAvailable: true,
    sourceCheckedAtMs: NOW - 60_000,
    maxSourceAgeMs: 86_400_000,
    nowMs: NOW,
  };
}

test("sums every explicit landed-cost component in integer cents", () => {
  const result = calculateLandedCost(baseInput());
  assert.deepEqual(result, { eligible: true, reason: "OK", landedCostCents: 1_300 });
});

test("fails closed when source data is unverified", () => {
  const result = calculateLandedCost({ ...baseInput(), sourceVerified: false });
  assert.deepEqual(result, { eligible: false, reason: "SOURCE_UNVERIFIED", landedCostCents: null });
});

test("fails closed when the supplier item is unavailable", () => {
  const result = calculateLandedCost({ ...baseInput(), sourceAvailable: false });
  assert.deepEqual(result, { eligible: false, reason: "SOURCE_UNAVAILABLE", landedCostCents: null });
});

test("fails closed when source cost data is stale", () => {
  const result = calculateLandedCost({ ...baseInput(), sourceCheckedAtMs: NOW - 86_400_001 });
  assert.deepEqual(result, { eligible: false, reason: "SOURCE_STALE", landedCostCents: null });
});

test("rejects missing-equivalent or nonsensical financial inputs", () => {
  const result = calculateLandedCost({ ...baseInput(), itemCostCents: 0 });
  assert.deepEqual(result, { eligible: false, reason: "INVALID_INPUT", landedCostCents: null });
});
