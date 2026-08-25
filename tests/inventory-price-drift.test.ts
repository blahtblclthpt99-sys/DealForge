import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  evaluatePersistedOfferBinding,
  type LivePersistedOffer,
  type PersistedOfferBindingInput,
} from "../src/lib/persisted-offer-binding";

const NOW = Date.parse("2026-08-25T15:30:00.000Z");
const SOURCE_VERIFIED_AT = "2026-08-25T12:00:00.000Z";
const PRICE_VERIFIED_AT = "2026-08-25T15:00:00.000Z";
const LANDED_COST_CENTS = 2725;

function specifications() {
  return JSON.stringify({
    supplierOfferV1: {
      supplierName: "Verified Supplier",
      sourceClass: "authorized_dropshipper",
      sourceUrl: "https://supplier.example/item",
      resaleAllowed: true,
      sourceVerifiedAt: SOURCE_VERIFIED_AT,
      priceVerifiedAt: PRICE_VERIFIED_AT,
      inventoryConfidenceBps: 9300,
      availability: "in_stock",
      persistedSupplierId: "supplier-a",
      persistedOfferId: "offer-a",
      persistedOfferKey: "offer_v1_test",
      costBreakdown: {
        itemCostCents: 2200,
        shippingCents: 300,
        taxCents: 100,
        supplierFeeCents: 75,
        handlingCents: 50,
        landedCostCents: LANDED_COST_CENTS,
      },
    },
  });
}

function input(): PersistedOfferBindingInput {
  return {
    productId: "product-a",
    currency: "usd",
    availability: "in_stock",
    landedCostCents: LANDED_COST_CENTS,
    priceVerifiedAt: new Date(PRICE_VERIFIED_AT),
    specifications: specifications(),
  };
}

function liveOffer(observedPriceCents: number): LivePersistedOffer {
  return {
    id: "offer-a",
    offerKey: "offer_v1_test",
    supplierId: "supplier-a",
    productId: "product-a",
    sourceUrl: "https://supplier.example/item",
    active: true,
    availability: "in_stock",
    currency: "usd",
    itemCostCents: 2200,
    shippingCents: 300,
    taxCents: 100,
    supplierFeeCents: 75,
    handlingCents: 50,
    priceVerifiedAt: new Date(PRICE_VERIFIED_AT),
    inventoryConfidenceBps: 9300,
    priority: 100,
    latestInventoryObservation: {
      supplierOfferId: "offer-a",
      availability: "in_stock",
      quantity: 5,
      inventoryConfidenceBps: 9300,
      observedPriceCents,
      observedAt: new Date("2026-08-25T15:25:00.000Z"),
      expiresAt: new Date("2026-08-25T15:45:00.000Z"),
      verificationMethod: "supplier_feed",
      provenance: "supplier.example/feed/item-a",
      sourceHealth: "healthy",
    },
    supplier: {
      name: "Verified Supplier",
      active: true,
      sourceClass: "authorized_dropshipper",
      resaleAllowed: true,
      sourceVerifiedAt: new Date(SOURCE_VERIFIED_AT),
    },
  };
}

test("matching current observed supplier price preserves checkout eligibility", () => {
  const result = evaluatePersistedOfferBinding(input(), liveOffer(2200), NOW);
  assert.equal(result.allowed, true);
  assert.deepEqual(result.reasons, []);
});

test("changed observed supplier price fails checkout before repricing", () => {
  const result = evaluatePersistedOfferBinding(input(), liveOffer(2350), NOW);
  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(","), /live_offer_inventory_observation_price_drift/);
});

test("inventory worker demotes on price drift without rewriting supplier economics", async () => {
  const operations = await readFile("src/lib/inventory-operations.ts", "utf8");
  const store = await readFile("src/lib/inventory-observation-store.ts", "utf8");

  assert.match(operations, /observed_supplier_price_drift/);
  assert.match(operations, /persistedItemCostCents/);
  assert.match(operations, /priceDrifted/);
  assert.doesNotMatch(operations, /itemCostCents:\s*latest\.observedPriceCents/);
  assert.doesNotMatch(operations, /commerceEnabled:\s*true/);

  assert.match(store, /"observedPriceCents"/);
  assert.match(store, /observedPriceCents: row\.observedPriceCents/);
});
