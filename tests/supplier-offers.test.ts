import assert from "node:assert/strict";
import test from "node:test";
import {
  computeLandedCostCents,
  evaluateSupplierOffer,
  selectBestSupplierOffer,
  type SupplierOfferCandidate,
} from "../src/lib/supplier-offers";

const NOW = Date.parse("2026-08-24T20:30:00Z");

function offer(overrides: Partial<SupplierOfferCandidate> = {}): SupplierOfferCandidate {
  return {
    id: "offer-a",
    supplierId: "supplier-a",
    supplierActive: true,
    offerActive: true,
    sourceClass: "authorized_dropshipper",
    resaleAllowed: true,
    sourceVerifiedAt: new Date("2026-08-24T18:00:00Z"),
    priceVerifiedAt: new Date("2026-08-24T20:00:00Z"),
    availability: "in_stock",
    currency: "usd",
    unitCostCents: 2200,
    shippingCents: 300,
    taxCents: 100,
    handlingCents: 50,
    inventoryConfidenceBps: 9300,
    priority: 100,
    ...overrides,
  };
}

const policy = {
  currency: "usd",
  maxSourceAgeDays: 30,
  maxPriceAgeMinutes: 180,
  minInventoryConfidenceBps: 8000,
};

test("landed cost is derived only from valid integer cost components", () => {
  assert.equal(computeLandedCostCents(offer()), 2650);
  assert.equal(computeLandedCostCents(offer({ unitCostCents: 0 })), null);
  assert.equal(computeLandedCostCents(offer({ shippingCents: -1 })), null);
});

test("eligible direct-resale supplier offer passes fail-closed validation", () => {
  const result = evaluateSupplierOffer(offer(), policy, NOW);
  assert.equal(result.eligible, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.landedCostCents, 2650);
});

test("affiliate-only, stale, weak inventory, and currency-mismatched offers are rejected", () => {
  const result = evaluateSupplierOffer(
    offer({
      sourceClass: "affiliate_only",
      sourceVerifiedAt: new Date("2026-06-01T00:00:00Z"),
      inventoryConfidenceBps: 4000,
      currency: "cad",
    }),
    policy,
    NOW,
  );
  assert.equal(result.eligible, false);
  assert.match(result.reasons.join(","), /source_class_not_direct_resale/);
  assert.match(result.reasons.join(","), /source_verification_stale_or_invalid/);
  assert.match(result.reasons.join(","), /inventory_confidence_below_floor/);
  assert.match(result.reasons.join(","), /currency_mismatch/);
});

test("selector chooses lowest landed cost then deterministic reliability tie-breakers", () => {
  const result = selectBestSupplierOffer(
    [
      offer({ id: "offer-expensive", unitCostCents: 2600, inventoryConfidenceBps: 9900, priority: 1 }),
      offer({ id: "offer-cheap-low-confidence", unitCostCents: 2100, inventoryConfidenceBps: 8500, priority: 50 }),
      offer({ id: "offer-cheap-preferred", unitCostCents: 2100, inventoryConfidenceBps: 9500, priority: 10 }),
    ],
    policy,
    NOW,
  );
  assert.equal(result.selected?.offer.id, "offer-cheap-preferred");
  assert.equal(result.selected?.landedCostCents, 2550);
});

test("selector returns no source when every offer fails eligibility", () => {
  const result = selectBestSupplierOffer(
    [
      offer({ id: "out", availability: "out_of_stock" }),
      offer({ id: "unverified", resaleAllowed: false }),
    ],
    policy,
    NOW,
  );
  assert.equal(result.selected, null);
  assert.equal(result.evaluated.every((entry) => !entry.eligible), true);
});
