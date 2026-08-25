import assert from "node:assert/strict";
import test from "node:test";
import type { InventoryObservationSnapshot } from "../src/lib/inventory-freshness";
import {
  evaluateProcurementSourceRevalidation,
  type LiveProcurementSupplierOffer,
} from "../src/lib/procurement-source-revalidation";

const NOW = Date.parse("2026-08-25T18:45:00Z");

function snapshot(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    persistedSupplierId: "supplier-1",
    persistedOfferId: "offer-1",
    persistedOfferKey: "offer-key-1",
    supplierName: "Verified Supplier",
    sourceClass: "authorized_dropshipper",
    sourceUrl: "https://supplier.example/item/1",
    sourceVerifiedAt: "2026-08-25T18:00:00.000Z",
    priceVerifiedAt: "2026-08-25T18:30:00.000Z",
    inventoryConfidenceBps: 9300,
    availability: "in_stock",
    currency: "usd",
    costBreakdown: {
      itemCostCents: 2000,
      shippingCents: 300,
      taxCents: 100,
      supplierFeeCents: 50,
      handlingCents: 50,
      landedCostCents: 2500,
    },
    ...overrides,
  });
}

function liveOffer(overrides: Partial<LiveProcurementSupplierOffer> = {}): LiveProcurementSupplierOffer {
  return {
    id: "offer-1",
    offerKey: "offer-key-1",
    supplierId: "supplier-1",
    productId: "product-1",
    sourceUrl: "https://supplier.example/item/1",
    active: true,
    availability: "in_stock",
    currency: "usd",
    itemCostCents: 2000,
    shippingCents: 300,
    taxCents: 100,
    supplierFeeCents: 50,
    handlingCents: 50,
    priceVerifiedAt: new Date("2026-08-25T18:30:00.000Z"),
    inventoryConfidenceBps: 9300,
    priority: 10,
    supplier: {
      name: "Verified Supplier",
      active: true,
      sourceClass: "authorized_dropshipper",
      resaleAllowed: true,
      sourceVerifiedAt: new Date("2026-08-25T18:00:00.000Z"),
    },
    ...overrides,
  };
}

function observation(overrides: Partial<InventoryObservationSnapshot> = {}): InventoryObservationSnapshot {
  return {
    supplierOfferId: "offer-1",
    availability: "in_stock",
    quantity: 4,
    inventoryConfidenceBps: 9300,
    observedPriceCents: 2000,
    observedAt: new Date("2026-08-25T18:35:00.000Z"),
    expiresAt: new Date("2026-08-25T19:35:00.000Z"),
    verificationMethod: "signed_adapter",
    provenance: "supplier-api",
    sourceHealth: "healthy",
    ...overrides,
  };
}

const input = {
  supplierSnapshot: snapshot(),
  productId: "product-1",
  currency: "usd",
  expectedUnitCostCents: 2500,
};

test("manual procurement source passes only with current exact persisted offer evidence", () => {
  const decision = evaluateProcurementSourceRevalidation(input, liveOffer(), observation(), NOW);
  assert.equal(decision.allowed, true);
  assert.deepEqual(decision.reasons, []);
  assert.equal(decision.persistedOfferId, "offer-1");
  assert.equal(decision.currentLandedCostCents, 2500);
});

test("newer verification timestamps are accepted when identity and frozen cost remain unchanged", () => {
  const decision = evaluateProcurementSourceRevalidation(
    input,
    liveOffer({
      priceVerifiedAt: new Date("2026-08-25T18:40:00.000Z"),
      supplier: {
        ...liveOffer().supplier,
        sourceVerifiedAt: new Date("2026-08-25T18:40:00.000Z"),
      },
    }),
    observation({ observedAt: new Date("2026-08-25T18:40:00.000Z"), expiresAt: new Date("2026-08-25T19:40:00.000Z") }),
    NOW,
  );
  assert.equal(decision.allowed, true);
});

test("stale price or stale inventory evidence blocks manual approval", () => {
  const stalePrice = evaluateProcurementSourceRevalidation(
    { ...input, supplierSnapshot: snapshot({ priceVerifiedAt: "2026-08-25T14:00:00.000Z" }) },
    liveOffer({ priceVerifiedAt: new Date("2026-08-25T14:00:00.000Z") }),
    observation(),
    NOW,
  );
  assert.equal(stalePrice.allowed, false);
  assert.ok(stalePrice.reasons.includes("live_offer_price_verification_stale_or_invalid"));

  const staleInventory = evaluateProcurementSourceRevalidation(
    input,
    liveOffer(),
    observation({ observedAt: new Date("2026-08-25T17:00:00.000Z"), expiresAt: new Date("2026-08-25T18:00:00.000Z") }),
    NOW,
  );
  assert.equal(staleInventory.allowed, false);
  assert.ok(staleInventory.reasons.includes("live_offer_inventory_observation_stale"));
});

test("disabled, non-resale, out-of-stock, or weak-current inventory cannot pass approval", () => {
  const disabled = evaluateProcurementSourceRevalidation(
    input,
    liveOffer({ active: false, supplier: { ...liveOffer().supplier, active: false, resaleAllowed: false } }),
    observation({ availability: "out_of_stock", inventoryConfidenceBps: 4000 }),
    NOW,
  );
  assert.equal(disabled.allowed, false);
  const reasons = disabled.reasons.join(",");
  assert.match(reasons, /live_offer_supplier_inactive/);
  assert.match(reasons, /live_offer_offer_inactive/);
  assert.match(reasons, /live_offer_resale_not_verified/);
  assert.match(reasons, /live_offer_inventory_not_in_stock/);
  assert.match(reasons, /live_offer_inventory_confidence_below_floor/);
});

test("observed supplier price drift blocks approval even before persisted cost is rewritten", () => {
  const decision = evaluateProcurementSourceRevalidation(
    input,
    liveOffer(),
    observation({ observedPriceCents: 2150 }),
    NOW,
  );
  assert.equal(decision.allowed, false);
  assert.ok(decision.reasons.includes("observed_supplier_price_drift"));
});

test("changed landed cost blocks approval against the immutable paid-order economics", () => {
  const decision = evaluateProcurementSourceRevalidation(
    input,
    liveOffer({ itemCostCents: 2150 }),
    observation({ observedPriceCents: 2150 }),
    NOW,
  );
  assert.equal(decision.allowed, false);
  assert.ok(decision.reasons.includes("procurement_landed_cost_drift"));
  assert.equal(decision.currentLandedCostCents, 2650);
});

test("persisted source identity drift fails closed", () => {
  const decision = evaluateProcurementSourceRevalidation(
    input,
    liveOffer({
      offerKey: "different-key",
      supplierId: "different-supplier",
      sourceUrl: "https://supplier.example/item/changed",
      supplier: { ...liveOffer().supplier, sourceClass: "wholesale" },
    }),
    observation(),
    NOW,
  );
  assert.equal(decision.allowed, false);
  const reasons = decision.reasons.join(",");
  assert.match(reasons, /persisted_offer_key_mismatch/);
  assert.match(reasons, /persisted_supplier_id_mismatch/);
  assert.match(reasons, /persisted_source_class_drift/);
  assert.match(reasons, /persisted_source_url_drift/);
});

test("missing or invalid procurement snapshots and missing persisted offers fail closed", () => {
  const invalid = evaluateProcurementSourceRevalidation(
    { ...input, supplierSnapshot: "{}" },
    liveOffer(),
    observation(),
    NOW,
  );
  assert.deepEqual(invalid.reasons, ["procurement_snapshot_missing_or_invalid"]);

  const missing = evaluateProcurementSourceRevalidation(input, null, null, NOW);
  assert.equal(missing.allowed, false);
  assert.deepEqual(missing.reasons, ["persisted_offer_missing"]);
});
