import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { prepareCommercialization, recommendCommercialPrice } from "../src/lib/commercialization";

const NOW = Date.parse("2026-08-24T20:30:00Z");

function goodInput() {
  return {
    supplierName: "Verified Supplier",
    sourceClass: "authorized_dropshipper" as const,
    sourceUrl: "https://supplier.example/product/123",
    resaleAllowed: true as const,
    sourceVerifiedAt: "2026-08-24T19:00:00Z",
    priceVerifiedAt: "2026-08-24T20:00:00Z",
    itemCostCents: 3000,
    shippingCents: 100,
    taxCents: 100,
    supplierFeeCents: 50,
    handlingCents: 50,
    sellingPriceCents: 5000,
    inventoryConfidenceBps: 9500,
    acquisitionReserveCents: 0,
    availability: "in_stock" as const,
  };
}

test("verified profitable supplier offer becomes commerce-ready", () => {
  const result = prepareCommercialization("{}", goodInput(), NOW);
  assert.equal(result.landedCostCents, 3300);
  assert.equal(result.commerceEnabled, true);
  assert.equal(result.decision.allowed, true);
  assert.ok((result.decision.contributionProfitCents ?? 0) >= 500);
  assert.ok((result.decision.contributionMarginBps ?? 0) >= 1000);

  const specifications = JSON.parse(result.specifications);
  assert.equal(specifications.supplierOfferV1.supplierName, "Verified Supplier");
  assert.equal(specifications.supplierOfferV1.costBreakdown.landedCostCents, 3300);
  assert.equal(specifications.commerceV1.resaleAllowed, true);
});

test("dynamic pricing recommendation includes variable reserves and clears floors", () => {
  const input = goodInput();
  const result = recommendCommercialPrice({
    itemCostCents: input.itemCostCents,
    shippingCents: input.shippingCents,
    taxCents: input.taxCents,
    supplierFeeCents: input.supplierFeeCents,
    handlingCents: input.handlingCents,
    acquisitionReserveCents: 250,
  });
  assert.equal(result.landedCostCents, 3300);
  assert.ok(result.reserveTotalCents >= 250);
  assert.ok(result.recommendedPriceCents >= result.minimumSafePriceCents);
  assert.ok(result.contributionProfitCents >= 500);
  assert.ok(result.contributionMarginBps >= 1000);
  assert.equal(result.recommendedPriceCents % 100, 99);
});

test("dynamic pricing refuses to sacrifice profit to match an unsafe market price", () => {
  const result = recommendCommercialPrice({
    itemCostCents: 8000,
    shippingCents: 500,
    taxCents: 0,
    supplierFeeCents: 0,
    handlingCents: 0,
    acquisitionReserveCents: 500,
    marketReferenceCents: 9000,
    maxMarketPremiumBps: 500,
  });
  assert.equal(result.marketCompatible, false);
  assert.match(result.reasons.join(","), /safe_price_exceeds_market_ceiling/);
  assert.ok(result.contributionProfitCents >= 500);
  assert.ok(result.contributionMarginBps >= 1000);
});

test("stale supplier price blocks commerce-ready state", () => {
  const result = prepareCommercialization(
    "{}",
    { ...goodInput(), priceVerifiedAt: "2026-08-24T15:00:00Z" },
    NOW,
  );
  assert.equal(result.commerceEnabled, false);
  assert.match(result.decision.reasons.join(","), /supplier_cost_verification_stale/);
});

test("weak inventory confidence blocks commerce-ready state", () => {
  const result = prepareCommercialization(
    "{}",
    { ...goodInput(), inventoryConfidenceBps: 7000 },
    NOW,
  );
  assert.equal(result.commerceEnabled, false);
  assert.match(result.decision.reasons.join(","), /inventory_confidence_below_floor/);
});

test("insufficient contribution profit blocks commerce-ready state", () => {
  const result = prepareCommercialization(
    "{}",
    { ...goodInput(), sellingPriceCents: 4000 },
    NOW,
  );
  assert.equal(result.commerceEnabled, false);
  assert.match(result.decision.reasons.join(","), /contribution_profit_below_floor/);
});

test("certification product cannot be commercialized", () => {
  assert.throws(
    () => prepareCommercialization(JSON.stringify({ internalCertification: true }), goodInput(), NOW),
    /CERTIFICATION_PRODUCT_IMMUTABLE/,
  );
});

test("supplier source URL must be public HTTPS", () => {
  assert.throws(
    () => prepareCommercialization("{}", { ...goodInput(), sourceUrl: "http://supplier.example/item" }, NOW),
    /SOURCE_URL_HTTPS_REQUIRED/,
  );
  assert.throws(
    () => prepareCommercialization("{}", { ...goodInput(), sourceUrl: "https://127.0.0.1/item" }, NOW),
    /SOURCE_URL_PRIVATE_HOST/,
  );
});

test("commercialization remains owner-only and does not alter the global commerce switch", async () => {
  const route = await readFile("src/app/api/admin/product-engine/route.ts", "utf8");
  const recommendationRoute = await readFile("src/app/api/admin/product-engine/recommend-price/route.ts", "utf8");
  assert.match(route, /PRODUCT_ENGINE_OWNER_EMAIL/);
  assert.match(route, /action: z\.literal\("commercialize"\)/);
  assert.match(route, /prepareCommercialization/);
  assert.doesNotMatch(route, /process\.env\.COMMERCE_ENABLED\s*=/);
  assert.match(recommendationRoute, /PRODUCT_ENGINE_OWNER_EMAIL/);
  assert.match(recommendationRoute, /recommendCommercialPrice/);
  assert.match(recommendationRoute, /recommendation_only/);
});
