import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  LOSS_RESERVE_PRIOR_EXPOSURE_CENTS,
  calculateSmoothedLossReserveBps,
} from "../src/lib/loss-reserve-policy";

test("automatic reserve keeps the baseline when no certified receipts exist", () => {
  const result = calculateSmoothedLossReserveBps({ baselineBps: 100, certifiedNetReceiptsCents: 0, realizedLossCents: 0 });
  assert.deepEqual(result, { observedLossBps: 0, evidenceWeightBps: 0, lossReserveBps: 100 });
});

test("small early loss samples are strongly shrunk toward the baseline", () => {
  const result = calculateSmoothedLossReserveBps({ baselineBps: 100, certifiedNetReceiptsCents: 100_000, realizedLossCents: 100_000 });
  assert.equal(LOSS_RESERVE_PRIOR_EXPOSURE_CENTS, 2_500_000);
  assert.equal(result.observedLossBps, 200);
  assert.ok(result.evidenceWeightBps < 500);
  assert.equal(result.lossReserveBps, 104);
});

test("clean certified history can reduce the reserve gradually instead of dropping it instantly", () => {
  const result = calculateSmoothedLossReserveBps({ baselineBps: 100, certifiedNetReceiptsCents: 2_500_000, realizedLossCents: 0 });
  assert.equal(result.observedLossBps, 0);
  assert.equal(result.evidenceWeightBps, 5_000);
  assert.equal(result.lossReserveBps, 50);
});

test("observed and smoothed loss reserve can never exceed the canonical 2 percent cap", () => {
  const result = calculateSmoothedLossReserveBps({ baselineBps: 100, certifiedNetReceiptsCents: 100_000_000, realizedLossCents: 100_000_000 });
  assert.equal(result.observedLossBps, 200);
  assert.ok(result.lossReserveBps <= 200);
  assert.throws(() => calculateSmoothedLossReserveBps({ baselineBps: 201, certifiedNetReceiptsCents: 1, realizedLossCents: 0 }), /BASELINE_BPS_INVALID/);
});

test("rolling reserve reads only paid trailing-window orders and certified realized contribution", async () => {
  const source = await readFile("src/lib/loss-reserve-policy.ts", "utf8");
  assert.match(source, /LOSS_RESERVE_WINDOW_DAYS = 30/);
  assert.match(source, /paidAt: \{ gte: windowStart, lte: windowEnd \}/);
  assert.match(source, /profit\.contribution\.certifiedOrderContributionCents/);
  assert.match(source, /if \(!profit\.contribution\.certified \|\| contribution === null\)/);
  assert.match(source, /if \(contribution < 0\)/);
  assert.match(source, /LOSS_RESERVE_MAX_WINDOW_ORDERS \+ 1/);
  assert.match(source, /baseline_fallback/);
  assert.match(source, /stale_snapshot/);
});

test("all money-authoritative pricing paths resolve the same operational policy", async () => {
  const quote = await readFile("src/app/api/cart/quote/route.ts", "utf8");
  const addons = await readFile("src/app/api/cart/addons/route.ts", "utf8");
  const checkout = await readFile("src/app/api/checkout/route.ts", "utf8");
  const recommendation = await readFile("src/app/api/admin/product-engine/recommend-price/route.ts", "utf8");
  const supplier = await readFile("src/lib/supplier-commercialization.ts", "utf8");
  for (const source of [quote, addons, checkout, recommendation, supplier]) assert.match(source, /resolveOperationalCartPricingPolicy/);
  assert.match(quote, /policy: pricingPolicy/);
  assert.match(addons, /policy: pricingPolicy/);
  assert.match(checkout, /policy: pricingPolicy \?\? undefined/);
  assert.match(recommendation, /recommendCommercialPrice\(parsed\.data, resolvedPolicy\.policy\)/);
  assert.match(supplier, /nowMs,\s*pricingPolicy,/);
});
