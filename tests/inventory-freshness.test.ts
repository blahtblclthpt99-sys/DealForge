import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInventoryObservationIdempotencyKey,
  evaluateInventoryFreshness,
} from "../src/lib/inventory-freshness";

const observedAt = new Date("2026-08-25T12:00:00.000Z");
const expiresAt = new Date("2026-08-25T13:00:00.000Z");

function observation(overrides: Record<string, unknown> = {}) {
  return {
    supplierOfferId: "offer-1",
    availability: "in_stock",
    quantity: 4,
    inventoryConfidenceBps: 9000,
    observedAt,
    expiresAt,
    verificationMethod: "owner_manual",
    provenance: "supplier portal",
    sourceHealth: "healthy",
    ...overrides,
  } as Parameters<typeof evaluateInventoryFreshness>[0];
}

const policy = { minInventoryConfidenceBps: 8000, requireCurrent: true };

test("fresh inventory moves from current to aging to stale", () => {
  assert.deepEqual(
    evaluateInventoryFreshness(observation(), policy, Date.parse("2026-08-25T12:30:00Z")),
    { state: "current", promotable: true, reasons: [] },
  );

  const aging = evaluateInventoryFreshness(observation(), policy, Date.parse("2026-08-25T12:50:00Z"));
  assert.equal(aging.state, "aging");
  assert.equal(aging.promotable, false);
  assert.ok(aging.reasons.includes("inventory_observation_aging"));

  const stale = evaluateInventoryFreshness(observation(), policy, Date.parse("2026-08-25T13:00:00Z"));
  assert.equal(stale.state, "stale");
  assert.equal(stale.promotable, false);
  assert.ok(stale.reasons.includes("inventory_observation_stale"));
});

test("missing, invalid, paused, out-of-stock, zero-quantity, and weak observations fail closed", () => {
  assert.equal(evaluateInventoryFreshness(null, policy).state, "unknown");
  assert.equal(evaluateInventoryFreshness(observation({ expiresAt: observedAt }), policy).state, "unknown");
  assert.equal(evaluateInventoryFreshness(observation({ sourceHealth: "paused" }), policy).state, "paused");

  for (const entry of [
    observation({ availability: "out_of_stock" }),
    observation({ quantity: 0 }),
    observation({ inventoryConfidenceBps: 7999 }),
  ]) {
    assert.equal(
      evaluateInventoryFreshness(entry, policy, Date.parse("2026-08-25T12:30:00Z")).promotable,
      false,
    );
  }
});

test("inventory observation idempotency keys are stable and material changes produce a new key", () => {
  const base = {
    supplierOfferId: "offer-1",
    observedAt,
    availability: "IN_STOCK",
    observedPriceCents: 1299,
    quantity: 4,
    verificationMethod: "OWNER_MANUAL",
    provenance: "supplier portal",
  };
  const first = buildInventoryObservationIdempotencyKey(base);
  const duplicate = buildInventoryObservationIdempotencyKey({ ...base, availability: "in_stock", verificationMethod: "owner_manual" });
  const changed = buildInventoryObservationIdempotencyKey({ ...base, quantity: 3 });

  assert.equal(first, duplicate);
  assert.notEqual(first, changed);
  assert.match(first, /^inventory_v1_[a-f0-9]{64}$/);
});
