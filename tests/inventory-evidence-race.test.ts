import assert from "node:assert/strict";
import test from "node:test";
import {
  bindInventoryEvidenceToSpecifications,
  evaluateInventoryEvidenceBinding,
  evaluateSpecificationsInventoryEvidenceBinding,
} from "../src/lib/inventory-evidence-binding";

const NOW = Date.parse("2026-08-26T06:20:00.000Z");

function observation(observedAtMs: number, provenance: string) {
  return {
    supplierOfferId: "offer_race",
    availability: "in_stock",
    quantity: 8,
    inventoryConfidenceBps: 9600,
    observedPriceCents: 4200,
    observedAt: new Date(observedAtMs),
    expiresAt: new Date(observedAtMs + 20 * 60_000),
    verificationMethod: "owner_manual",
    provenance,
    sourceHealth: "healthy",
  };
}

function specifications() {
  return JSON.stringify({
    supplierOfferV1: {
      supplierName: "Supplier",
      sourceClass: "authorized_dropshipper",
      sourceUrl: "https://supplier.example/race",
      resaleAllowed: true,
      sourceVerifiedAt: new Date(NOW - 120_000).toISOString(),
      priceVerifiedAt: new Date(NOW - 120_000).toISOString(),
      inventoryConfidenceBps: 9600,
      availability: "in_stock",
      persistedSupplierId: "supplier_race",
      persistedOfferId: "offer_race",
      persistedOfferKey: "offer_key_race",
      costBreakdown: {
        itemCostCents: 4200,
        shippingCents: 0,
        taxCents: 0,
        supplierFeeCents: 0,
        handlingCents: 0,
        landedCostCents: 4200,
      },
    },
  });
}

function withRequiredEvidence(run: () => void) {
  const previous = process.env.INVENTORY_EVIDENCE_BINDING_REQUIRED;
  process.env.INVENTORY_EVIDENCE_BINDING_REQUIRED = "true";
  try { run(); }
  finally {
    if (previous === undefined) delete process.env.INVENTORY_EVIDENCE_BINDING_REQUIRED;
    else process.env.INVENTORY_EVIDENCE_BINDING_REQUIRED = previous;
  }
}

test("exact current inventory observation matches bound commercialization evidence", () => {
  withRequiredEvidence(() => {
    const current = observation(NOW - 60_000, "supplier portal snapshot A");
    const decision = evaluateInventoryEvidenceBinding(current, { supplierOfferId: "offer_race", itemCostCents: 4200 }, NOW);
    assert.equal(decision.allowed, true);
    assert.ok(decision.evidence);
    const bound = bindInventoryEvidenceToSpecifications(specifications(), "offer_race", decision.evidence);
    const verified = evaluateSpecificationsInventoryEvidenceBinding(
      bound,
      current,
      { supplierOfferId: "offer_race", itemCostCents: 4200 },
      NOW,
    );
    assert.equal(verified.allowed, true);
    assert.deepEqual(verified.reasons, []);
  });
});

test("newer same-state observation invalidates older bound evidence", () => {
  withRequiredEvidence(() => {
    const first = observation(NOW - 120_000, "supplier portal snapshot A");
    const firstDecision = evaluateInventoryEvidenceBinding(first, { supplierOfferId: "offer_race", itemCostCents: 4200 }, NOW);
    assert.ok(firstDecision.evidence);
    const bound = bindInventoryEvidenceToSpecifications(specifications(), "offer_race", firstDecision.evidence);

    const newer = observation(NOW - 30_000, "supplier portal snapshot B");
    const verified = evaluateSpecificationsInventoryEvidenceBinding(
      bound,
      newer,
      { supplierOfferId: "offer_race", itemCostCents: 4200 },
      NOW,
    );

    assert.equal(verified.allowed, false);
    assert.ok(verified.reasons.includes("inventory_bound_evidence_drift"));
    assert.notEqual(verified.evidence?.idempotencyKey, firstDecision.evidence.idempotencyKey);
  });
});

test("missing bound evidence fails closed when production binding is required", () => {
  withRequiredEvidence(() => {
    const current = observation(NOW - 30_000, "supplier portal snapshot current");
    const verified = evaluateSpecificationsInventoryEvidenceBinding(
      specifications(),
      current,
      { supplierOfferId: "offer_race", itemCostCents: 4200 },
      NOW,
    );
    assert.equal(verified.allowed, false);
    assert.ok(verified.reasons.includes("inventory_bound_evidence_missing_or_invalid"));
  });
});
