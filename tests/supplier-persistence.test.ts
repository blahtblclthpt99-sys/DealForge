import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { toSupplierOfferCandidate } from "../src/lib/supplier-store";
import { evaluateSupplierOffer } from "../src/lib/supplier-offers";

const NOW = Date.parse("2026-08-24T23:20:00Z");

function row() {
  return {
    id: "offer-1",
    offerKey: "offer-key-1",
    supplierId: "supplier-1",
    sourceUrl: "https://supplier.example/items/1",
    active: true,
    availability: "in_stock",
    currency: "usd",
    itemCostCents: 2000,
    shippingCents: 300,
    taxCents: 100,
    supplierFeeCents: 50,
    handlingCents: 50,
    priceVerifiedAt: new Date("2026-08-24T22:50:00Z"),
    inventoryConfidenceBps: 9200,
    priority: 10,
    supplier: {
      name: "Verified Supplier",
      active: true,
      sourceClass: "authorized_dropshipper",
      resaleAllowed: true,
      sourceVerifiedAt: new Date("2026-08-20T12:00:00Z"),
    },
  };
}

const policy = {
  currency: "usd",
  maxSourceAgeDays: 30,
  maxPriceAgeMinutes: 180,
  minInventoryConfidenceBps: 8000,
};

test("persisted supplier rows map exactly into the fail-closed selector contract", () => {
  const candidate = toSupplierOfferCandidate(row());
  assert.equal(candidate.id, "offer-1");
  assert.equal(candidate.offerKey, "offer-key-1");
  assert.equal(candidate.supplierId, "supplier-1");
  assert.equal(candidate.supplierName, "Verified Supplier");
  assert.equal(candidate.sourceUrl, "https://supplier.example/items/1");
  assert.equal(candidate.sourceClass, "authorized_dropshipper");
  assert.equal(candidate.resaleAllowed, true);
  assert.equal(candidate.itemCostCents, 2000);
  assert.equal(candidate.supplierFeeCents, 50);
  assert.equal(evaluateSupplierOffer(candidate, policy, NOW).eligible, true);
});

test("persisted inactive or unverified suppliers remain fail-closed", () => {
  const inactive = row();
  inactive.supplier.active = false;
  inactive.supplier.resaleAllowed = false;
  const result = evaluateSupplierOffer(toSupplierOfferCandidate(inactive), policy, NOW);
  assert.equal(result.eligible, false);
  assert.match(result.reasons.join(","), /supplier_inactive/);
  assert.match(result.reasons.join(","), /resale_not_verified/);
});

test("both Prisma schemas contain the same normalized supplier model surface", async () => {
  const [sqlite, postgres] = await Promise.all([
    readFile("prisma/schema.prisma", "utf8"),
    readFile("prisma/schema.postgres.prisma", "utf8"),
  ]);
  for (const schema of [sqlite, postgres]) {
    assert.match(schema, /model Supplier \{/);
    assert.match(schema, /model SupplierOffer \{/);
    assert.match(schema, /offerKey\s+String\s+@unique/);
    assert.match(schema, /sourceVerifiedAt\s+DateTime\?/);
    assert.match(schema, /priceVerifiedAt\s+DateTime\?/);
    assert.match(schema, /inventoryConfidenceBps\s+Int/);
    assert.match(schema, /supplierOffers SupplierOffer\[\]/);
  }
});

test("production migration is additive and does not enable commerce", async () => {
  const migration = await readFile(
    "prisma/migrations/20260824232000_supplier_persistence_v1/migration.sql",
    "utf8",
  );
  assert.match(migration, /CREATE TABLE "Supplier"/);
  assert.match(migration, /CREATE TABLE "SupplierOffer"/);
  assert.match(migration, /SupplierOffer_offerKey_key/);
  assert.match(migration, /REFERENCES "Product"\("id"\) ON DELETE CASCADE/);
  assert.doesNotMatch(migration, /UPDATE\s+"Product"/i);
  assert.doesNotMatch(migration, /commerceEnabled"\s*=\s*true/i);
});

test("persisted supplier adapter is read-only and bounded", async () => {
  const source = await readFile("src/lib/supplier-store.ts", "utf8");
  assert.match(source, /prisma\.supplierOffer\.findMany/);
  assert.match(source, /take: 100/);
  assert.match(source, /selectBestSupplierOffer/);
  assert.doesNotMatch(source, /\.create\(/);
  assert.doesNotMatch(source, /\.update\(/);
  assert.doesNotMatch(source, /\.upsert\(/);
  assert.doesNotMatch(source, /\.delete/);
});
