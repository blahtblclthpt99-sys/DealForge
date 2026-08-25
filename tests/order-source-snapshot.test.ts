import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildOrderSupplierSnapshot,
  serializeOrderSupplierSnapshot,
} from "../src/lib/order-source-snapshot";

function specifications(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    supplierOfferV1: {
      supplierName: "Verified Supplier",
      sourceClass: "authorized_dropshipper",
      sourceUrl: "https://supplier.example/item",
      resaleAllowed: true,
      sourceVerifiedAt: "2026-08-24T20:00:00.000Z",
      priceVerifiedAt: "2026-08-25T00:30:00.000Z",
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
        landedCostCents: 2725,
      },
      ...overrides,
    },
  });
}

test("builds a deterministic immutable supplier snapshot for an order line", () => {
  const snapshot = buildOrderSupplierSnapshot(specifications(), "USD");
  assert.ok(snapshot);
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.persistedSupplierId, "supplier-a");
  assert.equal(snapshot.persistedOfferId, "offer-a");
  assert.equal(snapshot.persistedOfferKey, "offer_v1_test");
  assert.equal(snapshot.currency, "usd");
  assert.equal(snapshot.costBreakdown.landedCostCents, 2725);
  assert.equal(
    serializeOrderSupplierSnapshot(snapshot),
    serializeOrderSupplierSnapshot(buildOrderSupplierSnapshot(specifications(), "usd")),
  );
});

test("missing persisted provenance fails closed", () => {
  assert.equal(buildOrderSupplierSnapshot(specifications({ persistedOfferId: "" }), "usd"), null);
  assert.equal(buildOrderSupplierSnapshot(specifications({ persistedOfferKey: null }), "usd"), null);
  assert.equal(buildOrderSupplierSnapshot(specifications({ resaleAllowed: false }), "usd"), null);
});

test("cost-component or landed-cost drift fails closed", () => {
  const invalid = specifications({
    costBreakdown: {
      itemCostCents: 2200,
      shippingCents: 300,
      taxCents: 100,
      supplierFeeCents: 75,
      handlingCents: 50,
      landedCostCents: 2726,
    },
  });
  assert.equal(buildOrderSupplierSnapshot(invalid, "usd"), null);
});

test("order schemas and additive production migration persist the supplier snapshot", async () => {
  const sqlite = await readFile("prisma/schema.prisma", "utf8");
  const postgres = await readFile("prisma/schema.postgres.prisma", "utf8");
  const migration = await readFile(
    "prisma/migrations/20260825015500_order_item_supplier_snapshot/migration.sql",
    "utf8",
  );

  for (const schema of [sqlite, postgres]) {
    assert.match(schema, /supplierSnapshot\s+String\s+@default\("\{\}"\)/);
  }
  assert.match(migration, /ALTER TABLE "OrderItem"/);
  assert.match(migration, /ADD COLUMN "supplierSnapshot" TEXT NOT NULL DEFAULT '\{\}'/);
});

test("checkout persists exact source economics and revalidates them before Stripe", async () => {
  const route = await readFile("src/app/api/checkout/route.ts", "utf8");
  assert.match(route, /buildOrderSupplierSnapshot/);
  assert.match(route, /supplierSnapshotByProductId\.set\(product\.id, serializeOrderSupplierSnapshot\(snapshot\)\)/);
  assert.match(route, /const supplierSnapshot = supplierSnapshotByProductId\.get\(product\.id\)/);
  assert.match(route, /supplierSnapshot \}\)\) \},/);
  assert.match(route, /item\.supplierSnapshot === live\.supplierSnapshot/);
  assert.match(route, /ORDER_SOURCE_CHANGED_RESTART_CHECKOUT/);

  const revalidate = route.indexOf('stage = "pre_stripe_supplier_revalidation"');
  const stripe = route.indexOf('stage = "stripe_session"');
  assert.ok(revalidate >= 0, "missing pre-Stripe supplier revalidation stage");
  assert.ok(stripe > revalidate, "Stripe session must be created only after source revalidation");

  const revalidationBlock = route.slice(revalidate, stripe);
  assert.match(revalidationBlock, /checkPersistedOfferBinding/);
  assert.match(revalidationBlock, /buildOrderSupplierSnapshot/);
  assert.match(revalidationBlock, /serializeOrderSupplierSnapshot\(refreshedSnapshot\) !== item\.supplierSnapshot/);
});
