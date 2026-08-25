import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeOrderOperations } from "../src/lib/order-operations";

const root = process.cwd();
const adminRoute = readFileSync(join(root, "src/app/api/admin/commerce/orders/route.ts"), "utf8");
const ordersPage = readFileSync(join(root, "src/app/dashboard/orders/page.tsx"), "utf8");

test("operations analysis is refund-aware and reconciles supplier cost", () => {
  const result = analyzeOrderOperations({
    totalCents: 10_000,
    refunds: [{ status: "succeeded", amountCents: 1_000 }],
    items: [
      {
        id: "line_1",
        lineTotalCents: 10_000,
        procurementIntent: {
          status: "delivered",
          blockedReason: null,
          expectedTotalCostCents: 5_000,
          actualTotalCostCents: 5_500,
          createdAt: "2026-08-20T00:00:00.000Z",
          updatedAt: "2026-08-21T00:00:00.000Z",
        },
      },
    ],
    nowMs: Date.parse("2026-08-24T00:00:00.000Z"),
  });

  assert.equal(result.financials.retainedRevenueCents, 9_000);
  assert.equal(result.financials.knownActualSupplierCostCents, 5_500);
  assert.equal(result.financials.projectedContributionCents, 3_500);
  assert.equal(result.financials.fullyCostReconciled, true);
  assert.ok(result.exceptions.some((item) => item.code === "SUPPLIER_COST_OVERRUN"));
});

test("missing procurement intent is a critical order exception", () => {
  const result = analyzeOrderOperations({
    totalCents: 5_000,
    refunds: [],
    items: [{ id: "line_missing", lineTotalCents: 5_000, procurementIntent: null }],
    nowMs: Date.parse("2026-08-24T00:00:00.000Z"),
  });
  assert.equal(result.highestSeverity, "critical");
  assert.ok(result.exceptions.some((item) => item.code === "MISSING_PROCUREMENT_INTENT"));
});

test("large supplier overrun and zero margin are critical", () => {
  const result = analyzeOrderOperations({
    totalCents: 6_000,
    refunds: [],
    items: [
      {
        id: "line_loss",
        lineTotalCents: 6_000,
        procurementIntent: {
          status: "supplier_ordered_manual",
          blockedReason: null,
          expectedTotalCostCents: 4_000,
          actualTotalCostCents: 6_000,
          createdAt: "2026-08-24T00:00:00.000Z",
          updatedAt: "2026-08-24T00:00:00.000Z",
        },
      },
    ],
    nowMs: Date.parse("2026-08-24T01:00:00.000Z"),
  });
  assert.equal(result.highestSeverity, "critical");
  assert.ok(result.exceptions.some((item) => item.code === "SUPPLIER_COST_OVERRUN_HIGH"));
  assert.ok(result.exceptions.some((item) => item.code === "NEGATIVE_OR_ZERO_LINE_MARGIN"));
});

test("stale review, sourcing, and shipping states become warnings", () => {
  const now = Date.parse("2026-08-24T00:00:00.000Z");
  const result = analyzeOrderOperations({
    totalCents: 12_000,
    refunds: [],
    items: [
      {
        id: "review",
        lineTotalCents: 4_000,
        procurementIntent: {
          status: "awaiting_review",
          blockedReason: null,
          expectedTotalCostCents: 2_000,
          actualTotalCostCents: null,
          createdAt: "2026-08-22T00:00:00.000Z",
          updatedAt: "2026-08-22T00:00:00.000Z",
        },
      },
      {
        id: "ordered",
        lineTotalCents: 4_000,
        procurementIntent: {
          status: "supplier_ordered_manual",
          blockedReason: null,
          expectedTotalCostCents: 2_000,
          actualTotalCostCents: 2_000,
          createdAt: "2026-08-19T00:00:00.000Z",
          updatedAt: "2026-08-19T00:00:00.000Z",
        },
      },
      {
        id: "shipped",
        lineTotalCents: 4_000,
        procurementIntent: {
          status: "shipped",
          blockedReason: null,
          expectedTotalCostCents: 2_000,
          actualTotalCostCents: 2_000,
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
      },
    ],
    nowMs: now,
  });
  const codes = new Set(result.exceptions.map((item) => item.code));
  assert.equal(codes.has("AWAITING_REVIEW_OVER_24H"), true);
  assert.equal(codes.has("SUPPLIER_ORDER_NOT_SHIPPED_OVER_72H"), true);
  assert.equal(codes.has("SHIPMENT_NOT_DELIVERED_OVER_14D"), true);
});

test("admin order operations feed is strictly read-only and owner-only", () => {
  assert.match(adminRoute, /requireAdmin/);
  assert.match(adminRoute, /readOnly: true/);
  assert.match(adminRoute, /automaticSupplierPurchasingEnabled: false/);
  assert.match(adminRoute, /analyzeOrderOperations/);
  assert.doesNotMatch(adminRoute, /export async function POST/);
  assert.doesNotMatch(adminRoute, /\bfetch\s*\(/);
});

test("customer orders page scopes by current user and omits supplier internals", () => {
  assert.match(ordersPage, /where: \{ userId: user\.id \}/);
  assert.match(ordersPage, /projectPublicShipment/);
  assert.match(ordersPage, /Track package/);
  for (const forbidden of [
    "supplierSnapshot",
    "supplierOrderReference",
    "actualTotalCostCents",
    "expectedTotalCostCents",
    "blockedReason",
    "approvedByUserId",
  ]) {
    assert.equal(ordersPage.includes(forbidden), false, `orders page leaked ${forbidden}`);
  }
});
