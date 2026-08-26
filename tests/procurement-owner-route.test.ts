import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const routePath = new URL("../src/app/api/admin/procurement/[id]/route.ts", import.meta.url);
const queuePath = new URL("../src/app/api/admin/procurement/route.ts", import.meta.url);
const revalidationPath = new URL("../src/lib/procurement-source-revalidation.ts", import.meta.url);

test("procurement owner actions require owner authorization and manual-only execution", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /requireProcurementOwner/);
  assert.match(source, /isSameOriginProcurementMutation\(request\)/);
  assert.match(source, /executionMode !== "manual_only"/);
  assert.match(source, /PROCUREMENT_EXECUTION_MODE_UNSAFE/);
  assert.match(source, /automaticSupplierPurchasingEnabled: false/);
});

test("procurement owner actions recheck paid financial state and blocked provenance", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /intent\.order\.status !== "paid"/);
  assert.match(source, /PROCUREMENT_ORDER_NOT_PAID/);
  assert.match(source, /blocked_source_integrity/);
  assert.match(source, /PROCUREMENT_SOURCE_INTEGRITY_BLOCKED/);
});

test("approval and manual purchase revalidate the exact persisted source before and inside the transaction", async () => {
  const source = await readFile(routePath, "utf8");
  const calls = source.match(/checkProcurementSourceRevalidation\(/g) || [];
  assert.ok(calls.length >= 2);
  assert.match(source, /parsed\.data\.action === "APPROVE_MANUAL" \|\| parsed\.data\.action === "RECORD_MANUAL_PURCHASE"/);
  assert.match(source, /PROCUREMENT_LIVE_SOURCE_REVALIDATION_FAILED/);
  assert.match(source, /PROCUREMENT_PURCHASE_SOURCE_REVALIDATION_FAILED/);
  assert.match(source, /liveSourceRevalidated: true/);
  assert.match(source, /purchaseSourceRevalidated: transactionSourceRevalidation\?\.allowed === true/);
  assert.match(source, /persistedOfferId: transactionSourceRevalidation\.persistedOfferId/);
  assert.match(source, /currentLandedCostCents: transactionSourceRevalidation\.currentLandedCostCents/);
  assert.match(source, /transactionNowMs,\s*tx/);
});

test("live procurement source revalidation is strict and decision-only", async () => {
  const source = await readFile(revalidationPath, "utf8");
  assert.match(source, /requireCurrentInventoryObservation: true/);
  assert.match(source, /MAX_SOURCE_AGE_DAYS/);
  assert.match(source, /MAX_PRICE_AGE_MINUTES/);
  assert.match(source, /MIN_INVENTORY_CONFIDENCE_BPS/);
  assert.match(source, /procurement_landed_cost_drift/);
  assert.match(source, /observed_supplier_price_drift/);
  assert.doesNotMatch(source, /commerceEnabled\s*[:=]\s*true|stripe|purchase/i);
});

test("manual purchase requires exact paid-order source lock plus variance and loss controls", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /manualPurchaseConfirmed: z\.literal\(true\)/);
  assert.match(source, /supplierOfferId,/);
  assert.match(source, /sourceLockKey,/);
  assert.match(source, /deriveProcurementSourceLock/);
  const confirmations = source.match(/procurementSourceConfirmationMatches\(/g) || [];
  assert.ok(confirmations.length >= 2);
  assert.match(source, /PROCUREMENT_LOCKED_SOURCE_MISMATCH/);
  assert.match(source, /sourceLockConfirmed: true/);
  assert.match(source, /acceptCostVariance/);
  assert.match(source, /acceptLossRisk/);
  const economicsCalls = source.match(/validateManualPurchaseEconomics\(/g) || [];
  assert.ok(economicsCalls.length >= 2);
});

test("expired or invalid approval lease returns procurement to review and records the cause", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /evaluateProcurementApprovalLease/);
  assert.match(source, /PROCUREMENT_APPROVAL_EXPIRED/);
  assert.match(source, /APPROVAL_LEASE_EXPIRED/);
  assert.match(source, /APPROVAL_EVIDENCE_REVALIDATION_FAILED/);
  assert.match(source, /returnApprovalToReview/);
  assert.match(source, /status: "awaiting_review", approvedByUserId: null, approvedAt: null/);
  assert.match(source, /procurement-approval-reset:/);
  assert.match(source, /actor: "system"/);
});

test("owner procurement queue derives safe source-lock and approval-lease projections without returning raw snapshot", async () => {
  const source = await readFile(queuePath, "utf8");
  assert.match(source, /supplierSnapshot: true/);
  assert.match(source, /const \{ supplierSnapshot, \.\.\.safeIntent \} = intent/);
  assert.match(source, /deriveProcurementSourceLock\(/);
  assert.match(source, /lockedSource,/);
  assert.match(source, /evaluateProcurementApprovalLease\(safeIntent\.approvedAt, nowMs\)/);
  assert.match(source, /approvalLease,/);
  assert.doesNotMatch(source, /return\s*\{[\s\S]*\.\.\.safeIntent,[\s\S]*supplierSnapshot[,}]/);
  assert.match(source, /requireProcurementOwner/);
  assert.match(source, /automaticSupplierPurchasingEnabled: false/);
});
