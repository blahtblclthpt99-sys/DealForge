import assert from "node:assert/strict";
import test from "node:test";
import { checkPendingCheckoutSafety } from "../src/lib/pending-checkout-safety";

const NOW = Date.parse("2026-08-23T05:30:00.000Z");

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: "product-1",
    commerceEnabled: true,
    availability: "in_stock",
    currency: "usd",
    landedCostCents: 12_000,
    sellingPriceCents: 17_999,
    retailer: "amazon",
    affiliateUrl: "https://www.amazon.com/dp/B000000001",
    asin: "B000000001",
    specifications: {
      commerceRecommendation: {
        status: "owner_reviewed_recommendation",
        assessedAt: "2026-08-23T05:10:00.000Z",
        sourceCheckedAt: "2026-08-23T05:00:00.000Z",
        sourceVerified: true,
        sourceAvailable: true,
        maxSourceAgeMs: 3_600_000,
        sourceIdentity: {
          retailer: "amazon",
          sourceUrl: "https://www.amazon.com/dp/B000000001",
          asin: "B000000001",
        },
        result: {
          landedCostCents: 12_000,
          recommendedSellingPriceCents: 17_999,
        },
      },
    },
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    currency: "usd",
    totalCents: 17_999,
    financialGateCertified: true,
    nowMs: NOW,
    items: [
      {
        productId: "product-1",
        quantity: 1,
        unitPriceCents: 17_999,
        landedCostCents: 12_000,
      },
    ],
    products: [product()],
    ...overrides,
  };
}

test("accepts an unpaid checkout only when current commerce state still matches the order snapshot", () => {
  const result = checkPendingCheckoutSafety(input());
  assert.deepEqual(result, { safe: true, reason: "SAFE", detail: null });
});

test("blocks when the product is no longer safe for direct commerce", () => {
  const result = checkPendingCheckoutSafety(input({
    products: [product({ commerceEnabled: false })],
  }));
  assert.equal(result.safe, false);
  assert.equal(result.reason, "PRODUCT_UNSAFE");
  assert.equal(result.detail, "COMMERCE_DISABLED");
});

test("blocks source freshness expiration and identity drift", () => {
  const stale = checkPendingCheckoutSafety(input({
    nowMs: Date.parse("2026-08-23T06:00:00.001Z"),
  }));
  assert.equal(stale.reason, "PRODUCT_UNSAFE");
  assert.equal(stale.detail, "SOURCE_STALE");

  const drifted = checkPendingCheckoutSafety(input({
    products: [product({ affiliateUrl: "https://www.amazon.com/dp/B000000002" })],
  }));
  assert.equal(drifted.reason, "PRODUCT_UNSAFE");
  assert.equal(drifted.detail, "SOURCE_IDENTITY_DRIFT");
});

test("blocks financial snapshot and order total drift", () => {
  const priceDrift = checkPendingCheckoutSafety(input({
    products: [product({ sellingPriceCents: 18_999 })],
  }));
  assert.equal(priceDrift.reason, "PRODUCT_UNSAFE");
  assert.equal(priceDrift.detail, "FINANCIAL_DRIFT");

  const totalDrift = checkPendingCheckoutSafety(input({ totalCents: 18_000 }));
  assert.equal(totalDrift.reason, "ORDER_TOTAL_DRIFT");
});

test("blocks a cart that exceeds the pilot unit or financial exposure limits", () => {
  const item = {
    productId: "product-1",
    quantity: 6,
    unitPriceCents: 17_999,
    landedCostCents: 12_000,
  };
  const result = checkPendingCheckoutSafety(input({
    totalCents: item.unitPriceCents * item.quantity,
    items: [item],
  }));
  assert.equal(result.safe, false);
  assert.equal(result.reason, "EXPOSURE_LIMIT");
  assert.equal(result.detail, "LINE_QUANTITY_LIMIT_EXCEEDED");
});

test("fails closed on missing products and malformed order money", () => {
  assert.equal(checkPendingCheckoutSafety(input({ products: [] })).reason, "PRODUCT_MISSING");
  assert.equal(checkPendingCheckoutSafety(input({ totalCents: Number.MAX_SAFE_INTEGER + 1 })).reason, "ORDER_INVALID");
});
