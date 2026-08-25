import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const routePath = new URL("../src/app/api/admin/procurement/[id]/route.ts", import.meta.url);
const queuePath = new URL("../src/app/api/admin/procurement/route.ts", import.meta.url);

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

test("manual purchase requires explicit confirmation plus variance and loss controls", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /manualPurchaseConfirmed: z\.literal\(true\)/);
  assert.match(source, /acceptCostVariance/);
  assert.match(source, /acceptLossRisk/);
  assert.match(source, /validateManualPurchaseEconomics/);
});

test("procurement queue does not expose immutable supplier source snapshot", async () => {
  const source = await readFile(queuePath, "utf8");
  assert.doesNotMatch(source, /supplierSnapshot: true/);
  assert.match(source, /requireProcurementOwner/);
  assert.match(source, /automaticSupplierPurchasingEnabled: false/);
});
