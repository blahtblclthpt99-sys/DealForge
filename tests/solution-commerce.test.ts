import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_BUNDLE_RELEVANCE_SCORE,
  bundleRelevanceScore,
  chooseMonetizationMode,
  evaluateBasketProfit,
  recommendBundleTier,
  validateAmazonCommerceBoundary,
} from "../src/lib/solution-commerce";

const directRight = {
  sourceClass: "authorized_dropshipper" as const,
  resaleAllowed: true,
  affiliateAllowed: false,
  affiliateProvider: null,
};

const affiliateRight = {
  sourceClass: null,
  resaleAllowed: false,
  affiliateAllowed: true,
  affiliateProvider: "amazon" as const,
};

test("bundle relevance requires strong real-world fit", () => {
  const score = bundleRelevanceScore({
    compatibilityBps: 9500,
    purchaseRelationshipBps: 9000,
    usefulnessBps: 9000,
    priceAdvantageBps: 8000,
    marginContributionBps: 8500,
    supplierConfidenceBps: 9500,
  });
  assert.ok(score >= MIN_BUNDLE_RELEVANCE_SCORE);

  const junkScore = bundleRelevanceScore({
    compatibilityBps: 1500,
    purchaseRelationshipBps: 1000,
    usefulnessBps: 2000,
    priceAdvantageBps: 9000,
    marginContributionBps: 9500,
    supplierConfidenceBps: 9000,
  });
  assert.ok(junkScore < MIN_BUNDLE_RELEVANCE_SCORE);
});

test("basket profit gate permits low-margin anchor only when the whole governed basket is safe", () => {
  const decision = evaluateBasketProfit({
    minimumProfitCents: 1800,
    paymentCostCents: 420,
    refundReserveCents: 200,
    fraudReserveCents: 100,
    supportReserveCents: 100,
    components: [
      {
        id: "anchor",
        role: "ANCHOR",
        quantity: 1,
        sellingPriceCents: 8400,
        landedCostCents: 8000,
        reserveCents: 100,
        directFulfillment: true,
        commercialRight: directRight,
      },
      {
        id: "bits",
        role: "MARGIN_DRIVER",
        quantity: 1,
        sellingPriceCents: 1400,
        landedCostCents: 800,
        reserveCents: 50,
        directFulfillment: true,
        commercialRight: directRight,
      },
      {
        id: "case",
        role: "ATTACHMENT",
        quantity: 1,
        sellingPriceCents: 1900,
        landedCostCents: 700,
        reserveCents: 50,
        directFulfillment: true,
        commercialRight: directRight,
      },
    ],
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.contributionProfitCents, 2080);
});

test("basket fails closed when a direct component lacks resale rights", () => {
  const decision = evaluateBasketProfit({
    minimumProfitCents: 1,
    components: [{
      id: "unsafe",
      role: "ANCHOR",
      quantity: 1,
      sellingPriceCents: 2000,
      landedCostCents: 1000,
      reserveCents: 0,
      directFulfillment: true,
      commercialRight: affiliateRight,
    }],
  });

  assert.equal(decision.allowed, false);
  assert.ok(decision.reasons.includes("component_unsafe_resale_not_authorized"));
});

test("basket rejects selling a direct component below true landed cost", () => {
  const decision = evaluateBasketProfit({
    minimumProfitCents: 0,
    components: [{
      id: "loss-leader",
      role: "ANCHOR",
      quantity: 1,
      sellingPriceCents: 900,
      landedCostCents: 1000,
      reserveCents: 0,
      directFulfillment: true,
      commercialRight: directRight,
    }],
  });

  assert.equal(decision.allowed, false);
  assert.ok(decision.reasons.includes("component_loss-leader_below_landed_cost"));
});

test("Amazon affiliate components can monetize but cannot be fulfilled by DealForge", () => {
  const affiliateComponent = {
    id: "amazon-anchor",
    role: "ANCHOR" as const,
    quantity: 1,
    sellingPriceCents: 0,
    landedCostCents: 0,
    reserveCents: 0,
    affiliateCommissionCents: 450,
    directFulfillment: false,
    commercialRight: affiliateRight,
  };

  assert.equal(validateAmazonCommerceBoundary(affiliateComponent), true);
  assert.throws(
    () => validateAmazonCommerceBoundary({ ...affiliateComponent, directFulfillment: true }),
    /AMAZON_AFFILIATE_DIRECT_FULFILLMENT_FORBIDDEN/,
  );
});

test("monetization decision prefers governed hybrid and falls back safely", () => {
  assert.equal(chooseMonetizationMode({
    commercialRight: {
      sourceClass: "manufacturer",
      resaleAllowed: true,
      affiliateAllowed: true,
      affiliateProvider: "other",
    },
    hasDirectOffer: true,
    hasAffiliateOffer: true,
    directOfferPassesProfitGate: true,
    bundleCandidate: true,
    bundleRelevanceScore: 92,
    basketProfitPasses: true,
  }), "HYBRID");

  assert.equal(chooseMonetizationMode({
    commercialRight: affiliateRight,
    hasDirectOffer: false,
    hasAffiliateOffer: true,
    directOfferPassesProfitGate: false,
    bundleCandidate: false,
  }), "AFFILIATE");

  assert.equal(chooseMonetizationMode({
    commercialRight: { sourceClass: "retailer_permitting_resale", resaleAllowed: false },
    hasDirectOffer: true,
    hasAffiliateOffer: false,
    directOfferPassesProfitGate: true,
    bundleCandidate: false,
  }), "BLOCKED");
});

test("three-tier merchandising maps essential, best value, complete", () => {
  assert.equal(recommendBundleTier(0, 3), "ESSENTIAL");
  assert.equal(recommendBundleTier(1, 3), "BEST_VALUE");
  assert.equal(recommendBundleTier(2, 3), "COMPLETE");
});
