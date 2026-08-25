import test from "node:test";
import assert from "node:assert/strict";
import {
  transitionProcurement,
  validateManualPurchaseEconomics,
} from "../src/lib/procurement-state-machine";

test("manual procurement requires review before purchase recording", () => {
  assert.deepEqual(transitionProcurement("awaiting_review", "APPROVE_MANUAL"), {
    ok: true,
    next: "approved_manual",
  });
  assert.deepEqual(transitionProcurement("awaiting_review", "RECORD_MANUAL_PURCHASE"), {
    ok: false,
    reason: "INVALID_TRANSITION",
  });
  assert.deepEqual(transitionProcurement("approved_manual", "RECORD_MANUAL_PURCHASE"), {
    ok: true,
    next: "supplier_ordered_manual",
  });
});

test("hold cannot be bypassed directly into purchase", () => {
  assert.deepEqual(transitionProcurement("approved_manual", "PLACE_HOLD"), {
    ok: true,
    next: "hold",
  });
  assert.deepEqual(transitionProcurement("hold", "RECORD_MANUAL_PURCHASE"), {
    ok: false,
    reason: "INVALID_TRANSITION",
  });
  assert.deepEqual(transitionProcurement("hold", "RESUME_REVIEW"), {
    ok: true,
    next: "awaiting_review",
  });
});

test("cost increase requires explicit acknowledgement", () => {
  const result = validateManualPurchaseEconomics({
    actualTotalCostCents: 6500,
    expectedTotalCostCents: 6000,
    lineRevenueCents: 9000,
    acceptCostVariance: false,
    acceptLossRisk: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "COST_VARIANCE_REQUIRES_ACKNOWLEDGEMENT");
});

test("loss-risk purchase requires separate explicit acknowledgement", () => {
  const result = validateManualPurchaseEconomics({
    actualTotalCostCents: 9500,
    expectedTotalCostCents: 9000,
    lineRevenueCents: 9000,
    acceptCostVariance: true,
    acceptLossRisk: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "LOSS_RISK_REQUIRES_ACKNOWLEDGEMENT");
});

test("acknowledged manual purchase reports variance and projected gross margin", () => {
  const result = validateManualPurchaseEconomics({
    actualTotalCostCents: 6500,
    expectedTotalCostCents: 6000,
    lineRevenueCents: 9000,
    acceptCostVariance: true,
    acceptLossRisk: false,
  });
  assert.deepEqual(result, {
    ok: true,
    varianceCents: 500,
    projectedGrossMarginCents: 2500,
  });
});
