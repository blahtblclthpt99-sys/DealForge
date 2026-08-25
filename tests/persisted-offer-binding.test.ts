import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  evaluatePersistedOfferBinding,
  type LivePersistedOffer,
  type PersistedOfferBindingInput,
} from "../src/lib/persisted-offer-binding";

const NOW = Date.parse("2026-08-25T01:30:00Z");
const SOURCE_VERIFIED_AT = "2026-08-24T20:00:00.000Z";
const PRICE_VERIFIED_AT = "2026-08-25T00:30:00.000Z";
const INVENTORY_OBSERVED_AT = new Date("2026-08-25T01:20:00.000Z");
const INVENTORY_EXPIRES_AT = new Date("2026-08-25T01:40:00.000Z");
const LANDED_COST_CENTS = 2725;

type LiveOverrides = Partial<Omit<LivePersistedOffer, "supplier">> & {
  supplier?: Partial<LivePersistedOffer["supplier"]>;
};

function specs(overrides: Record<string, unknown> = {}) {
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
      ...overrides,
    },
  });
}

function input(overrides: Partial<PersistedOfferBindingInput> = {}): PersistedOfferBindingInput {
  return {
    productId: "product-a",
    currency: "usd",
    availability: "in_stock",
    landedCostCents: LANDED_COST_CENTS,
    priceVerifiedAt: new Date(PRICE_VERIFIED_AT),
    specifications: specs(),
    ...overrides,
  };
}

function liveOffer(overrides: LiveOverrides = {}): LivePersistedOffer {
  const base: LivePersistedOffer = {
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
      observedAt: INVENTORY_OBSERVED_AT,
      expiresAt: INVENTORY_EXPIRES_AT,
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
  return {
    ...base,
    ...overrides,
    supplier: { ...base.supplier, ...(overrides.supplier ?? {}) },
  };
}

test("exact live persisted supplier offer plus current inventory observation is accepted", () => {
  const result = evaluatePersistedOfferBinding(input(), liveOffer(), NOW);
  assert.equal(result.allowed, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.persistedOfferId, "offer-a");
});

test("missing or stale inventory observation fails closed before customer money", () => {
  const missing = evaluatePersistedOfferBinding(input(), liveOffer({ latestInventoryObservation: null }), NOW);
  assert.equal(missing.allowed, false);
  assert.match(missing.reasons.join(","), /live_offer_inventory_observation_missing/);

  const stale = evaluatePersistedOfferBinding(
    input(),
    liveOffer({
      latestInventoryObservation: {
        supplierOfferId: "offer-a",
        availability: "in_stock",
        quantity: 5,
        inventoryConfidenceBps: 9300,
        observedAt: new Date("2026-08-25T00:00:00.000Z"),
        expiresAt: new Date("2026-08-25T01:00:00.000Z"),
        verificationMethod: "supplier_feed",
        provenance: "supplier.example/feed/item-a",
        sourceHealth: "healthy",
      },
    }),
    NOW,
  );
  assert.equal(stale.allowed, false);
  assert.match(stale.reasons.join(","), /live_offer_inventory_observation_stale/);
});

test("inventory observation identity, availability, and confidence drift fail closed", () => {
  const result = evaluatePersistedOfferBinding(
    input(),
    liveOffer({
      latestInventoryObservation: {
        supplierOfferId: "other-offer",
        availability: "out_of_stock",
        quantity: 0,
        inventoryConfidenceBps: 8000,
        observedAt: INVENTORY_OBSERVED_AT,
        expiresAt: INVENTORY_EXPIRES_AT,
        verificationMethod: "supplier_feed",
        provenance: "supplier.example/feed/item-a",
        sourceHealth: "healthy",
      },
    }),
    NOW,
  );
  const reasons = result.reasons.join(",");
  assert.equal(result.allowed, false);
  assert.match(reasons, /live_offer_inventory_not_in_stock/);
  assert.match(reasons, /live_offer_inventory_quantity_zero/);
  assert.match(reasons, /live_offer_inventory_observation_offer_mismatch/);
  assert.match(reasons, /live_offer_inventory_observation_availability_drift/);
  assert.match(reasons, /live_offer_inventory_observation_confidence_drift/);
});

test("missing persisted provenance fails closed before checkout", () => {
  const result = evaluatePersistedOfferBinding(
    input({ specifications: JSON.stringify({ supplierOfferV1: { resaleAllowed: true } }) }),
    liveOffer(),
    NOW,
  );
  assert.equal(result.allowed, false);
  assert.deepEqual(result.reasons, ["persisted_offer_snapshot_missing_or_invalid"]);
});

test("deleted, inactive, or resale-revoked live supplier state fails closed", () => {
  const missing = evaluatePersistedOfferBinding(input(), null, NOW);
  assert.equal(missing.allowed, false);
  assert.match(missing.reasons.join(","), /persisted_offer_missing/);

  const revoked = evaluatePersistedOfferBinding(
    input(),
    liveOffer({ active: false, supplier: { active: false, resaleAllowed: false } }),
    NOW,
  );
  const reasons = revoked.reasons.join(",");
  assert.equal(revoked.allowed, false);
  assert.match(reasons, /live_offer_supplier_inactive/);
  assert.match(reasons, /live_offer_offer_inactive/);
  assert.match(reasons, /live_offer_resale_not_verified/);
});

test("supplier identity, source, timestamp, availability, currency, and confidence drift are rejected", () => {
  const result = evaluatePersistedOfferBinding(
    input(),
    liveOffer({
      offerKey: "offer_v1_other",
      supplierId: "supplier-b",
      productId: "product-b",
      sourceUrl: "https://supplier.example/other",
      availability: "unknown",
      currency: "cad",
      inventoryConfidenceBps: 7000,
      priceVerifiedAt: new Date("2026-08-25T00:45:00.000Z"),
      supplier: {
        sourceClass: "distributor",
        sourceVerifiedAt: new Date("2026-08-24T21:00:00.000Z"),
      },
    }),
    NOW,
  );
  const reasons = result.reasons.join(",");
  assert.equal(result.allowed, false);
  assert.match(reasons, /persisted_offer_key_mismatch/);
  assert.match(reasons, /persisted_supplier_id_mismatch/);
  assert.match(reasons, /persisted_offer_product_mismatch/);
  assert.match(reasons, /persisted_source_class_drift/);
  assert.match(reasons, /persisted_source_url_drift/);
  assert.match(reasons, /persisted_source_verification_drift/);
  assert.match(reasons, /persisted_price_verification_drift/);
  assert.match(reasons, /product_price_verification_drift/);
  assert.match(reasons, /persisted_inventory_confidence_drift/);
  assert.match(reasons, /persisted_availability_drift/);
  assert.match(reasons, /persisted_currency_drift/);
});

test("live landed-cost drift invalidates the product snapshot even when the selling price did not change", () => {
  const result = evaluatePersistedOfferBinding(input(), liveOffer({ itemCostCents: 2300 }), NOW);
  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(","), /persisted_landed_cost_drift/);
});

test("stale normalized supplier verification is rejected independently of copied Product JSON", () => {
  const result = evaluatePersistedOfferBinding(
    input({
      priceVerifiedAt: new Date("2026-08-24T20:00:00.000Z"),
      specifications: specs({
        priceVerifiedAt: "2026-08-24T20:00:00.000Z",
        sourceVerifiedAt: "2026-07-01T00:00:00.000Z",
      }),
    }),
    liveOffer({
      priceVerifiedAt: new Date("2026-08-24T20:00:00.000Z"),
      supplier: { sourceVerifiedAt: new Date("2026-07-01T00:00:00.000Z") },
    }),
    NOW,
  );
  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(","), /live_offer_source_verification_stale_or_invalid/);
  assert.match(result.reasons.join(","), /live_offer_price_verification_stale_or_invalid/);
});

test("checkout is wired to persisted binding, bounded JSON, user ownership, and exact order economics", async () => {
  const route = await readFile("src/app/api/checkout/route.ts", "utf8");
  const binding = await readFile("src/lib/persisted-offer-binding.ts", "utf8");
  assert.match(route, /checkPersistedOfferBinding/);
  assert.match(route, /PRODUCT_SUPPLIER_BINDING_FAILED/);
  assert.match(route, /persisted_offer_binding/);
  assert.match(route, /readLimitedJson\(request, MAX_CHECKOUT_BODY_BYTES\)/);
  assert.doesNotMatch(route, /await request\.json\(\)/);
  assert.match(route, /existing\.userId !== null && existing\.userId !== sessionUser\?\.id/);
  assert.match(route, /sameOrderEconomics/);
  assert.match(route, /item\.landedCostCents === live\.product\.landedCostCents/);
  assert.match(route, /order\.subtotalCents !== subtotalCents/);
  assert.match(binding, /readLatestInventoryObservation/);
  assert.match(binding, /requireCurrentInventoryObservation: true/);
});
