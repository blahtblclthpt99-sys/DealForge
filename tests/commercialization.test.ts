import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CANONICAL_PRICING_POLICY_VERSION,
  prepareCommercialization,
  recommendCommercialPrice,
} from "../src/lib/commercialization";
import { minimumSafeProfitCents } from "../src/lib/cart-pricing";

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
    taxClassification: "General tangible personal property",
    stripeTaxCode: "txcd_99999999",
    taxVerifiedAt: "2026-08-24T20:05:00Z",
    taxVerificationSource: "owner_manual_stripe_tax_review",
    taxMaxAgeDays: 365,
  };
}

test("verified supplier, profit, inventory, and tax evidence become commerce-ready together", () => {
  const result = prepareCommercialization("{}", goodInput(), NOW);
  assert.equal(result.landedCostCents, 3300);
  assert.equal(result.commerceEnabled, true);
  assert.equal(result.decision.allowed, true);
  assert.ok((result.decision.contributionProfitCents ?? 0) >= minimumSafeProfitCents(3300));

  const specifications = JSON.parse(result.specifications);
  assert.equal(specifications.supplierOfferV1.supplierName, "Verified Supplier");
  assert.equal(specifications.supplierOfferV1.costBreakdown.landedCostCents, 3300);
  assert.equal(specifications.taxV1.stripeTaxCode, "txcd_99999999");
  assert.equal(specifications.taxV1.classification, "General tangible personal property");
  assert.equal(specifications.taxV1.verificationSource, "owner_manual_stripe_tax_review");
  assert.equal(specifications.taxV1.maxAgeDays, 365);
  assert.equal(specifications.commerceV1.resaleAllowed, true);
  assert.equal(specifications.commerceV1.minContributionMarginBps, 0);
  assert.equal(specifications.commerceV1.reserves.chargebackCents, 0);
  assert.equal(specifications.commerceV1.reserves.fraudCents, 0);
  assert.equal(specifications.commerceV1.reserves.supportCents, 0);
  assert.equal(specifications.commerceV1.reserves.fulfillmentCents, 0);
  assert.equal(specifications.commerceV2.pricingPolicyVersion, CANONICAL_PRICING_POLICY_VERSION);
  assert.equal(specifications.commerceV2.maximumLossReserveBps, 200);
  assert.equal(specifications.commerceV2.rounding, "next_49_or_99_only");
});

test("attributable acquisition cost does not move the landed-cost profit tier", () => {
  const result = prepareCommercialization(
    "{}",
    { ...goodInput(), acquisitionReserveCents: 250 },
    NOW,
  );
  const specifications = JSON.parse(result.specifications);
  const expectedProfitFloor = minimumSafeProfitCents(3300);
  assert.equal(specifications.commerceV1.minContributionProfitCents, expectedProfitFloor);
  assert.equal(specifications.commerceV2.minimumProfitCents, expectedProfitFloor);
  assert.equal(specifications.commerceV2.attributableAcquisitionCostCents, 250);
});

test("price recommendation uses one payment allowance, one pooled loss reserve, and attributable cost", () => {
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
  assert.equal(result.reserves.acquisitionCents, 250);
  assert.equal(result.reserves.chargebackCents, 0);
  assert.equal(result.reserves.fraudCents, 0);
  assert.equal(result.reserves.supportCents, 0);
  assert.equal(result.reserves.fulfillmentCents, 0);
  assert.equal(result.reserveTotalCents, result.reserves.paymentCents + result.reserves.returnsCents + 250);
  assert.ok(result.recommendedPriceCents >= result.minimumSafePriceCents);
  assert.ok(result.contributionProfitCents >= result.minimumProfitCents);
  assert.ok([49, 99].includes(result.recommendedPriceCents % 100));
  assert.equal(result.pricingPolicyVersion, CANONICAL_PRICING_POLICY_VERSION);
});

test("safe pricing flags an unsafe market comparison instead of sacrificing profit", () => {
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
  assert.ok(result.contributionProfitCents >= result.minimumProfitCents);
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

test("insufficient tiered contribution profit blocks commerce-ready state", () => {
  const result = prepareCommercialization(
    "{}",
    { ...goodInput(), sellingPriceCents: 3800 },
    NOW,
  );
  assert.equal(result.commerceEnabled, false);
  assert.match(result.decision.reasons.join(","), /contribution_profit_below_floor/);
});

test("tax evidence is mandatory, bounded, current, and Stripe-code shaped", () => {
  assert.throws(
    () => prepareCommercialization("{}", { ...goodInput(), stripeTaxCode: "general" }, NOW),
    /STRIPE_TAX_CODE_INVALID/,
  );
  assert.throws(
    () => prepareCommercialization("{}", { ...goodInput(), taxClassification: "" }, NOW),
    /TAX_CLASSIFICATION_INVALID/,
  );
  assert.throws(
    () => prepareCommercialization("{}", { ...goodInput(), taxVerificationSource: "" }, NOW),
    /TAX_VERIFICATION_SOURCE_INVALID/,
  );
  assert.throws(
    () => prepareCommercialization("{}", { ...goodInput(), taxVerifiedAt: "2025-01-01T00:00:00Z" }, NOW),
    /TAX_CLASSIFICATION_STALE/,
  );
  assert.throws(
    () => prepareCommercialization("{}", { ...goodInput(), taxVerifiedAt: "2026-08-25T20:30:00Z" }, NOW),
    /TAX_VERIFIED_AT_IN_FUTURE/,
  );
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

test("commercialization remains owner-only, evidence-complete, persisted-first, and does not alter the global commerce switch", async () => {
  const route = await readFile("src/app/api/admin/product-engine/route.ts", "utf8");
  const controls = await readFile("src/components/product-engine-controls.tsx", "utf8");
  const recommendationRoute = await readFile("src/app/api/admin/product-engine/recommend-price/route.ts", "utf8");
  assert.match(route, /PRODUCT_ENGINE_OWNER_EMAIL/);
  assert.match(route, /action: z\.literal\("commercialize"\)/);
  assert.match(route, /taxClassification: z\.string/);
  assert.match(route, /stripeTaxCode: z\.string/);
  assert.match(route, /taxVerificationSource: z\.string/);
  assert.match(route, /persistSelectAndPrepareCommercialization/);
  assert.match(route, /NO_ELIGIBLE_SUPPLIER_OFFER/);
  assert.doesNotMatch(route, /process\.env\.COMMERCE_ENABLED\s*=/);
  assert.match(controls, /Tax classification/);
  assert.match(controls, /Stripe tax code/);
  assert.match(controls, /taxVerifiedAt: now/);
  assert.match(recommendationRoute, /PRODUCT_ENGINE_OWNER_EMAIL/);
  assert.match(recommendationRoute, /recommendCommercialPrice/);
  assert.match(recommendationRoute, /recommendation_only/);
});
