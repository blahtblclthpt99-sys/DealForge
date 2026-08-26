import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveProcurementSourceLock,
  procurementSourceConfirmationMatches,
} from "../src/lib/procurement-source-lock";

function supplierSnapshot(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    persistedSupplierId: "supplier_123",
    persistedOfferId: "offer_123",
    persistedOfferKey: "offer_key_123",
    supplierName: "Authorized Supplier",
    sourceClass: "authorized_dropshipper",
    sourceUrl: "https://supplier.example/item",
    sourceVerifiedAt: "2026-08-26T05:00:00.000Z",
    priceVerifiedAt: "2026-08-26T05:01:00.000Z",
    inventoryConfidenceBps: 9500,
    availability: "in_stock",
    currency: "usd",
    costBreakdown: {
      itemCostCents: 2500,
      shippingCents: 100,
      taxCents: 0,
      supplierFeeCents: 0,
      handlingCents: 0,
      landedCostCents: 2600,
    },
    ...overrides,
  });
}

test("same immutable paid-order source produces the same lock key", () => {
  const left = deriveProcurementSourceLock(supplierSnapshot(), 2600, "USD");
  const right = deriveProcurementSourceLock(supplierSnapshot(), 2600, "usd");
  assert.ok(left);
  assert.ok(right);
  assert.equal(left.sourceLockKey, right.sourceLockKey);
  assert.match(left.sourceLockKey, /^proc_source_lock_v1_[a-f0-9]{64}$/);
  assert.equal(left.persistedOfferId, "offer_123");
});

test("different supplier offer cannot reuse the paid-order source lock", () => {
  const locked = deriveProcurementSourceLock(supplierSnapshot(), 2600, "usd");
  const other = deriveProcurementSourceLock(
    supplierSnapshot({ persistedOfferId: "offer_other", persistedOfferKey: "offer_key_other" }),
    2600,
    "usd",
  );
  assert.ok(locked);
  assert.ok(other);
  assert.notEqual(locked.sourceLockKey, other.sourceLockKey);
  assert.equal(
    procurementSourceConfirmationMatches(locked, {
      supplierOfferId: "offer_other",
      sourceLockKey: locked.sourceLockKey,
    }),
    false,
  );
});

test("changed expected landed cost invalidates the lock contract", () => {
  assert.equal(deriveProcurementSourceLock(supplierSnapshot(), 2700, "usd"), null);
});

test("manual purchase confirmation must echo both exact offer and lock key", () => {
  const lock = deriveProcurementSourceLock(supplierSnapshot(), 2600, "usd");
  assert.ok(lock);
  assert.equal(
    procurementSourceConfirmationMatches(lock, {
      supplierOfferId: lock.persistedOfferId,
      sourceLockKey: lock.sourceLockKey,
    }),
    true,
  );
  assert.equal(
    procurementSourceConfirmationMatches(lock, {
      supplierOfferId: lock.persistedOfferId,
      sourceLockKey: `proc_source_lock_v1_${"0".repeat(64)}`,
    }),
    false,
  );
});
