import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluateInventoryFreshness } from "../src/lib/inventory-freshness";

const NOW = Date.parse("2026-08-25T15:30:00.000Z");

function observation(overrides: Record<string, unknown> = {}) {
  return {
    supplierOfferId: "offer-a",
    availability: "in_stock",
    quantity: 4,
    inventoryConfidenceBps: 9300,
    observedAt: new Date("2026-08-25T15:25:00.000Z"),
    expiresAt: new Date("2026-08-25T15:45:00.000Z"),
    verificationMethod: "supplier_feed",
    provenance: "supplier.example/feed/offer-a",
    sourceHealth: "healthy",
    ...overrides,
  };
}

test("fresh trusted inventory evidence is promotable at the freshness layer", () => {
  const result = evaluateInventoryFreshness(
    observation(),
    { minInventoryConfidenceBps: 8500, requireCurrent: true },
    NOW,
  );
  assert.equal(result.state, "current");
  assert.equal(result.promotable, true);
  assert.deepEqual(result.reasons, []);
});

test("expired, zero-quantity, paused, and low-confidence evidence fail closed", () => {
  const expired = evaluateInventoryFreshness(
    observation({ expiresAt: new Date("2026-08-25T15:29:59.000Z") }),
    { minInventoryConfidenceBps: 8500, requireCurrent: true },
    NOW,
  );
  assert.equal(expired.promotable, false);
  assert.equal(expired.state, "stale");

  const zero = evaluateInventoryFreshness(
    observation({ quantity: 0 }),
    { minInventoryConfidenceBps: 8500, requireCurrent: true },
    NOW,
  );
  assert.equal(zero.promotable, false);
  assert.match(zero.reasons.join(","), /inventory_quantity_zero/);

  const paused = evaluateInventoryFreshness(
    observation({ sourceHealth: "paused" }),
    { minInventoryConfidenceBps: 8500, requireCurrent: true },
    NOW,
  );
  assert.equal(paused.promotable, false);
  assert.equal(paused.state, "paused");

  const lowConfidence = evaluateInventoryFreshness(
    observation({ inventoryConfidenceBps: 7000 }),
    { minInventoryConfidenceBps: 8500, requireCurrent: true },
    NOW,
  );
  assert.equal(lowConfidence.promotable, false);
  assert.match(lowConfidence.reasons.join(","), /inventory_confidence_below_floor/);
});

test("inventory operations are monotonic-safe and never auto-enable commerce", async () => {
  const operations = await readFile("src/lib/inventory-operations.ts", "utf8");
  assert.match(operations, /data:\s*{\s*commerceEnabled:\s*false,\s*availability,/);
  assert.doesNotMatch(operations, /data:\s*{\s*commerceEnabled:\s*true\b/);
  assert.match(operations, /commercePromoted:\s*false as const/);
  assert.match(operations, /recordInventoryObservation/);
  assert.match(operations, /readLatestInventoryObservation/);
  assert.match(operations, /inventory_product_demoted/);
  assert.match(operations, /MAX_SWEEP_OFFERS = 250/);
  assert.match(operations, /enginePaused/);
});

test("owner inventory endpoint is bounded, same-origin, and authenticated", async () => {
  const route = await readFile("src/app/api/admin/inventory/route.ts", "utf8");
  assert.match(route, /requireAdmin/);
  assert.match(route, /PRODUCT_ENGINE_OWNER_EMAIL/);
  assert.match(route, /sameOrigin\(req\)/);
  assert.match(route, /readLimitedJson\(req, 24 \* 1024\)/);
  assert.match(route, /action: z\.literal\("observe"\)/);
  assert.match(route, /action: z\.literal\("sweep"\)/);
  assert.match(route, /max\(250\)/);
  assert.match(route, /INVENTORY_OBSERVED_AT_IN_FUTURE/);
});

test("observation journal uses deterministic dedupe and insert-only persistence", async () => {
  const store = await readFile("src/lib/inventory-observation-store.ts", "utf8");
  assert.match(store, /buildInventoryObservationIdempotencyKey/);
  assert.match(store, /INSERT INTO "InventoryObservation"/);
  assert.match(store, /ON CONFLICT \("idempotencyKey"\) DO NOTHING/);
  assert.doesNotMatch(store, /UPDATE "InventoryObservation"/);
  assert.doesNotMatch(store, /DELETE FROM "InventoryObservation"/);
});
