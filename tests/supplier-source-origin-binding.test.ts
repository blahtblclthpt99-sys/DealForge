import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluatePersistedOfferBinding,
  type LivePersistedOffer,
  type PersistedOfferBindingInput,
} from "../src/lib/persisted-offer-binding";
import {
  bindSupplierSourceProvenanceToMetadata,
  buildSupplierSourceProvenance,
} from "../src/lib/supplier-source-provenance";

const NOW = Date.parse("2026-08-26T06:00:00.000Z");
const SOURCE_VERIFIED_AT = "2026-08-26T05:00:00.000Z";
const PRICE_VERIFIED_AT = "2026-08-26T05:45:00.000Z";
const provenance = buildSupplierSourceProvenance({
  supplierName: "Verified Supplier",
  sourceClass: "authorized_dropshipper",
  sourceUrl: "https://supplier.example",
  resaleAllowed: true,
  sourceVerifiedAt: SOURCE_VERIFIED_AT,
});

function input(sourceUrl = "https://supplier.example/item"): PersistedOfferBindingInput {
  return {
    productId: "product-origin",
    currency: "usd",
    availability: "in_stock",
    landedCostCents: 2500,
    priceVerifiedAt: new Date(PRICE_VERIFIED_AT),
    specifications: JSON.stringify({
      supplierOfferV1: {
        supplierName: "Verified Supplier",
        sourceClass: "authorized_dropshipper",
        sourceUrl,
        resaleAllowed: true,
        sourceVerifiedAt: SOURCE_VERIFIED_AT,
        sourceVerificationV1: provenance,
        priceVerifiedAt: PRICE_VERIFIED_AT,
        inventoryConfidenceBps: 9500,
        availability: "in_stock",
        persistedSupplierId: "supplier-origin",
        persistedOfferId: "offer-origin",
        persistedOfferKey: "offer_v1_origin",
        costBreakdown: {
          itemCostCents: 2200,
          shippingCents: 200,
          taxCents: 50,
          supplierFeeCents: 25,
          handlingCents: 25,
          landedCostCents: 2500,
        },
      },
    }),
  };
}

function liveOffer(sourceUrl = "https://supplier.example/item"): LivePersistedOffer {
  return {
    id: "offer-origin",
    offerKey: "offer_v1_origin",
    supplierId: "supplier-origin",
    productId: "product-origin",
    sourceUrl,
    active: true,
    availability: "in_stock",
    currency: "usd",
    itemCostCents: 2200,
    shippingCents: 200,
    taxCents: 50,
    supplierFeeCents: 25,
    handlingCents: 25,
    priceVerifiedAt: new Date(PRICE_VERIFIED_AT),
    inventoryConfidenceBps: 9500,
    priority: 100,
    latestInventoryObservation: {
      supplierOfferId: "offer-origin",
      availability: "in_stock",
      quantity: 4,
      inventoryConfidenceBps: 9500,
      observedPriceCents: 2200,
      observedAt: new Date("2026-08-26T05:55:00.000Z"),
      expiresAt: new Date("2026-08-26T06:15:00.000Z"),
      verificationMethod: "supplier_feed",
      provenance: "supplier.example/feed/origin",
      sourceHealth: "healthy",
    },
    supplier: {
      name: "Verified Supplier",
      active: true,
      sourceClass: "authorized_dropshipper",
      websiteUrl: "https://supplier.example",
      resaleAllowed: true,
      sourceVerifiedAt: new Date(SOURCE_VERIFIED_AT),
      verificationSource: "owner_manual",
      metadata: bindSupplierSourceProvenanceToMetadata("{}", provenance),
    },
  };
}

test("verified supplier origin accepts an offer on that origin", () => {
  const result = evaluatePersistedOfferBinding(input(), liveOffer(), NOW);
  assert.equal(result.allowed, true);
  assert.deepEqual(result.reasons, []);
});

test("frozen and live offer origins cannot escape the verified supplier origin", () => {
  const wrongOrigin = "https://other.example/item";
  const result = evaluatePersistedOfferBinding(input(wrongOrigin), liveOffer(wrongOrigin), NOW);
  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(","), /persisted_source_provenance_offer_origin_drift/);
  assert.match(result.reasons.join(","), /live_supplier_source_provenance_offer_origin_drift/);
});
