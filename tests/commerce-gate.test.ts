import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluateCommerceGate } from "../src/lib/commerce-gate";

const NOW = Date.parse("2026-08-24T20:15:00Z");

function specifications(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    supplierOfferV1: {
      supplierName: "Test Supplier",
      sourceClass: "authorized_dropshipper",
      resaleAllowed: true,
      sourceVerifiedAt: "2026-08-24T19:00:00Z",
      priceVerifiedAt: "2026-08-24T19:30:00Z",
      inventoryConfidenceBps: 9500,
      availability: "in_stock",
    },
    commerceV1: {
      sourceClass: "authorized_dropshipper",
      resaleAllowed: true,
      sourceVerifiedAt: "2026-08-24T19:00:00Z",
      maxSourceAgeDays: 30,
      maxPriceAgeMinutes: 180,
      inventoryConfidenceBps: 9500,
      minInventoryConfidenceBps: 8000,
      minContributionProfitCents: 500,
      minContributionMarginBps: 1000,
      reserves: {
        paymentCents: 150,
        returnsCents: 150,
        chargebackCents: 75,
        fraudCents: 50,
        supportCents: 50,
        fulfillmentCents: 100,
        acquisitionCents: 0,
      },
      ...overrides,
    },
  });
}

function baseInput() {
  return {
    commerceEnabled: true,
    availability: "in_stock",
    sellingPriceCents: 5000,
    landedCostCents: 3000,
    priceVerifiedAt: new Date("2026-08-24T19:30:00Z"),
    specifications: specifications(),
  };
}

test("commercial gate approves only profitable verified direct-resale inventory", () => {
  const result = evaluateCommerceGate(baseInput(), NOW);
  assert.equal(result.allowed, true);
  assert.equal(result.contributionProfitCents, 1425);
  assert.equal(result.contributionMarginBps, 2850);
  assert.equal(result.reserveTotalCents, 575);
});

test("commercial gate reads supplier price freshness from persisted offer metadata", () => {
  const input = baseInput();
  const result = evaluateCommerceGate({
    commerceEnabled: input.commerceEnabled,
    availability: input.availability,
    sellingPriceCents: input.sellingPriceCents,
    landedCostCents: input.landedCostCents,
    specifications: input.specifications,
  }, NOW);
  assert.equal(result.allowed, true);
  assert.doesNotMatch(result.reasons.join(","), /supplier_cost_verification/);
});

test("commercial gate fails closed when persisted supplier price timestamp is missing", () => {
  const root = JSON.parse(specifications()) as Record<string, unknown>;
  const offer = root.supplierOfferV1 as Record<string, unknown>;
  delete offer.priceVerifiedAt;
  const input = baseInput();
  const result = evaluateCommerceGate({
    commerceEnabled: input.commerceEnabled,
    availability: input.availability,
    sellingPriceCents: input.sellingPriceCents,
    landedCostCents: input.landedCostCents,
    specifications: JSON.stringify(root),
  }, NOW);
  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(","), /supplier_cost_verification_invalid/);
});

test("commercial gate fails closed when policy is absent", () => {
  const result = evaluateCommerceGate({ ...baseInput(), specifications: "{}" }, NOW);
  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(","), /commercial_policy_missing_or_invalid/);
});

test("affiliate-only or unverified resale sources cannot enter direct commerce", () => {
  const affiliate = evaluateCommerceGate({ ...baseInput(), specifications: specifications({ sourceClass: "affiliate_only" }) }, NOW);
  assert.equal(affiliate.allowed, false);
  assert.match(affiliate.reasons.join(","), /source_class_not_direct_resale/);

  const notAllowed = evaluateCommerceGate({ ...baseInput(), specifications: specifications({ resaleAllowed: false }) }, NOW);
  assert.equal(notAllowed.allowed, false);
  assert.match(notAllowed.reasons.join(","), /resale_not_verified/);
});

test("stale supplier cost and weak inventory confidence block checkout", () => {
  const stale = evaluateCommerceGate({ ...baseInput(), priceVerifiedAt: new Date("2026-08-24T10:00:00Z") }, NOW);
  assert.equal(stale.allowed, false);
  assert.match(stale.reasons.join(","), /supplier_cost_verification_stale/);

  const weakInventory = evaluateCommerceGate({ ...baseInput(), specifications: specifications({ inventoryConfidenceBps: 5000 }) }, NOW);
  assert.equal(weakInventory.allowed, false);
  assert.match(weakInventory.reasons.join(","), /inventory_confidence_below_floor/);
});

test("profit and margin floors block unprofitable sales", () => {
  const result = evaluateCommerceGate({ ...baseInput(), landedCostCents: 4400 }, NOW);
  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(","), /contribution_profit_below_floor/);
  assert.match(result.reasons.join(","), /contribution_margin_below_floor/);
});

test("checkout route is wired to the fail-closed Phase 3 commercial gate", async () => {
  const route = await readFile("src/app/api/checkout/route.ts", "utf8");
  assert.match(route, /evaluateCommerceGate/);
  assert.match(route, /PRODUCT_COMMERCE_GATE_FAILED/);
});

test("checkout cannot reuse terminal orders and certification bypass is bound to the exact test product", async () => {
  const route = await readFile("src/app/api/checkout/route.ts", "utf8");
  assert.match(route, /TERMINAL_CHECKOUT_STATUSES/);
  assert.match(route, /"refunded"/);
  assert.match(route, /"partially_refunded"/);
  assert.match(route, /certificationAttempt &&/);
  assert.match(route, /CERTIFICATION_PRODUCT_ID/);
});

test("production commerce paths do not query undeployed Product provenance columns", async () => {
  const checkout = await readFile("src/app/api/checkout/route.ts", "utf8");
  const adminApi = await readFile("src/app/api/admin/product-engine/route.ts", "utf8");
  const adminPage = await readFile("src/app/admin/product-engine/page.tsx", "utf8");

  for (const source of [checkout, adminApi, adminPage]) {
    assert.doesNotMatch(source, /priceVerifiedAt:\s*true/);
    assert.doesNotMatch(source, /priceSource:\s*true/);
    assert.doesNotMatch(source, /metadataSource:\s*true/);
    assert.doesNotMatch(source, /metadataVerifiedAt:\s*true/);
  }

  assert.doesNotMatch(adminApi, /data:\s*\{[^}]*priceVerifiedAt:/s);
  assert.doesNotMatch(adminApi, /data:\s*\{[^}]*priceSource:/s);
  assert.doesNotMatch(adminApi, /data:\s*\{[^}]*metadataSource:/s);
  assert.doesNotMatch(adminApi, /data:\s*\{[^}]*metadataVerifiedAt:/s);
});
