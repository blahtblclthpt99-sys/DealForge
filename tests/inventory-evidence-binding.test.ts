import assert from "node:assert/strict";
import test from "node:test";
import {
  bindInventoryEvidenceToSpecifications,
  evaluateInventoryEvidenceBinding,
} from "../src/lib/inventory-evidence-binding";
import { buildOrderSupplierSnapshot } from "../src/lib/order-source-snapshot";

const NOW = Date.parse("2026-08-26T05:00:00.000Z");

function observation(overrides: Record<string, unknown> = {}) {
  return {
    supplierOfferId: "offer_123",
    availability: "in_stock",
    quantity: 12,
    inventoryConfidenceBps: 9500,
    observedPriceCents: 2500,
    observedAt: new Date(NOW - 60_000),
    expiresAt: new Date(NOW + 15 * 60_000),
    verificationMethod: "owner_manual",
    provenance: "supplier portal observation #abc",
    sourceHealth: "healthy",
    ...overrides,
  };
}

function specifications() {
  return JSON.stringify({
    supplierOfferV1: {
      supplierName: "Supplier",
      sourceClass: "authorized_dropshipper",
      sourceUrl: "https://supplier.example/item",
      resaleAllowed: true,
      sourceVerifiedAt: new Date(NOW - 60_000).toISOString(),
      priceVerifiedAt: new Date(NOW - 60_000).toISOString(),
      inventoryConfidenceBps: 9500,
      availability: "in_stock",
      persistedSupplierId: "supplier_123",
      persistedOfferId: "offer_123",
      persistedOfferKey: "offer_key_123",
      costBreakdown: {
        itemCostCents: 2500,
        shippingCents: 100,
        taxCents: 0,
        supplierFeeCents: 0,
        handlingCents: 0,
        landedCostCents: 2600,
      },
    },
  });
}

test("current exact-offer observation produces immutable evidence", () => {
  const decision = evaluateInventoryEvidenceBinding(observation(), { supplierOfferId: "offer_123", itemCostCents: 2500 }, NOW);
  assert.equal(decision.allowed, true);
  assert.ok(decision.evidence);
  assert.match(decision.evidence.idempotencyKey, /^inventory_v1_[a-f0-9]{64}$/);
  assert.match(decision.evidence.provenanceHash, /^[a-f0-9]{64}$/);
  assert.equal(decision.evidence.supplierOfferId, "offer_123");
  assert.equal(decision.evidence.availability, "in_stock");
});

test("stale observation fails closed", () => {
  const decision = evaluateInventoryEvidenceBinding(
    observation({ expiresAt: new Date(NOW - 1) }),
    { supplierOfferId: "offer_123", itemCostCents: 2500 },
    NOW,
  );
  assert.equal(decision.allowed, false);
  assert.ok(decision.reasons.includes("inventory_observation_stale"));
});

test("wrong persisted offer fails exact binding", () => {
  const decision = evaluateInventoryEvidenceBinding(observation(), { supplierOfferId: "offer_other", itemCostCents: 2500 }, NOW);
  assert.equal(decision.allowed, false);
  assert.ok(decision.reasons.includes("inventory_offer_binding_mismatch"));
});

test("observed supplier price drift fails binding", () => {
  const decision = evaluateInventoryEvidenceBinding(observation({ observedPriceCents: 2600 }), { supplierOfferId: "offer_123", itemCostCents: 2500 }, NOW);
  assert.equal(decision.allowed, false);
  assert.ok(decision.reasons.includes("observed_supplier_price_drift"));
});

test("bound evidence is frozen into the production order supplier snapshot", () => {
  const previous = process.env.INVENTORY_EVIDENCE_BINDING_REQUIRED;
  process.env.INVENTORY_EVIDENCE_BINDING_REQUIRED = "true";
  try {
    const decision = evaluateInventoryEvidenceBinding(observation(), { supplierOfferId: "offer_123", itemCostCents: 2500 }, NOW);
    assert.ok(decision.evidence);
    const bound = bindInventoryEvidenceToSpecifications(specifications(), "offer_123", decision.evidence);
    const snapshot = buildOrderSupplierSnapshot(bound, "usd");
    assert.ok(snapshot);
    assert.equal(snapshot.inventoryEvidence?.idempotencyKey, decision.evidence.idempotencyKey);
    assert.equal(snapshot.inventoryEvidence?.supplierOfferId, snapshot.persistedOfferId);
    assert.equal(snapshot.inventoryEvidence?.observedPriceCents, snapshot.costBreakdown.itemCostCents);
  } finally {
    if (previous === undefined) delete process.env.INVENTORY_EVIDENCE_BINDING_REQUIRED;
    else process.env.INVENTORY_EVIDENCE_BINDING_REQUIRED = previous;
  }
});

test("production-required order snapshot rejects missing inventory evidence", () => {
  const previous = process.env.INVENTORY_EVIDENCE_BINDING_REQUIRED;
  process.env.INVENTORY_EVIDENCE_BINDING_REQUIRED = "true";
  try {
    assert.equal(buildOrderSupplierSnapshot(specifications(), "usd"), null);
  } finally {
    if (previous === undefined) delete process.env.INVENTORY_EVIDENCE_BINDING_REQUIRED;
    else process.env.INVENTORY_EVIDENCE_BINDING_REQUIRED = previous;
  }
});
