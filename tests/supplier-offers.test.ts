import assert from "node:assert/strict";
import test from "node:test";
import {
  computeSupplierLandedCostCents,
  evaluateSupplierOffer,
  selectBestSupplierOffer,
  type SupplierOfferCandidate,
} from "../src/lib/supplier-offers";

const NOW = Date.parse("2026-08-24T22:30:00Z");

function offer(overrides: Partial<SupplierOfferCandidate> = {}): SupplierOfferCandidate {
  return {
    id: "offer-a",
    supplierId: "supplier-a",
    supplierActive: true,
    offerActive: true,
    sourceClass: "authorized_dropshipper",
    resaleAllowed: true,
    sourceVerifiedAt: new Date("2026-08-24T18:00:00Z"),
    priceVerifiedAt: new Date("2026-08-24T22:00:00Z"),
    availability: "in_stock",
    currency: "usd",
    itemCostCents: 2200,
    shippingCents: 300,
    taxCents: 100,
    supplierFeeCents: 75,
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

test("supplier landed cost includes every current DealForge cost component", () => {
  assert.equal(computeSupplierLandedCostCents(offer()), 2725);
  assert.equal(computeSupplierLandedCostCents(offer({ itemCostCents: 0 })), null);
  assert.equal(computeSupplierLandedCostCents(offer({ supplierFeeCents: -1 })), null);
});

test("eligible direct-resale supplier offer passes fail-closed validation", () => {
  const result = evaluateSupplierOffer(offer(), policy, NOW);
  assert.equal(result.eligible, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.landedCostCents, 2725);
});

test("affiliate-only, stale, weak inventory, and currency-mismatched offers are rejected", () => {
  const result = evaluateSupplierOffer(
    offer({
      sourceClass: "affiliate_only",
      sourceVerifiedAt: new Date("2026-06-01T00:00:00Z"),
      priceVerifiedAt: new Date("2026-08-24T10:00:00Z"),
      inventoryConfidenceBps: 4000,
      currency: "cad",
    }),
    policy,
    NOW,
  );
  const reasons = result.reasons.join(",");
  assert.equal(result.eligible, false);
  assert.match(reasons, /source_class_not_direct_resale/);
  assert.match(reasons, /source_verification_stale_or_invalid/);
  assert.match(reasons, /price_verification_stale_or_invalid/);
  assert.match(reasons, /inventory_confidence_below_floor/);
  assert.match(reasons, /currency_mismatch/);
});

test("inactive, out-of-stock, unverified, or malformed supplier offers cannot be selected", () => {
  const result = selectBestSupplierOffer(
    [
      offer({ id: "inactive", supplierActive: false }),
      offer({ id: "out", availability: "out_of_stock" }),
      offer({ id: "unverified", resaleAllowed: false }),
      offer({ id: "bad-cost", supplierFeeCents: -1 }),
    ],
    policy,
    NOW,
  );
  assert.equal(result.selected, null);
  assert.equal(result.evaluated.every((entry) => !entry.eligible), true);
});

test("selector chooses lowest landed cost then deterministic reliability tie-breakers", () => {
  const result = selectBestSupplierOffer(
    [
      offer({ id: "offer-expensive", itemCostCents: 2600, inventoryConfidenceBps: 9900, priority: 1 }),
      offer({ id: "offer-cheap-low-confidence", itemCostCents: 2100, inventoryConfidenceBps: 8500, priority: 50 }),
      offer({ id: "offer-cheap-preferred", itemCostCents: 2100, inventoryConfidenceBps: 9500, priority: 10 }),
    ],
    policy,
    NOW,
  );
  assert.equal(result.selected?.offer.id, "offer-cheap-preferred");
  assert.equal(result.selected?.landedCostCents, 2625);
});

test("supplier selection is decision-only and does not grant commerce authority", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile("src/lib/supplier-offers.ts", "utf8"));
  assert.doesNotMatch(source, /prisma\.|fetch\(|stripe|commerceEnabled\s*[:=]\s*true/i);
  assert.match(source, /does not purchase, mutate catalog state, or enable commerce/);
});
