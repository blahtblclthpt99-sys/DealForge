import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  supplierOfferPersistenceKey,
  supplierPersistenceKey,
} from "../src/lib/supplier-commercialization";

test("supplier persistence keys are deterministic and identity-scoped", () => {
  const a = supplierPersistenceKey(" Verified Supplier ", "authorized_dropshipper");
  const b = supplierPersistenceKey("verified   supplier", "authorized_dropshipper");
  const c = supplierPersistenceKey("Verified Supplier", "distributor");
  assert.equal(a, b);
  assert.notEqual(a, c);

  const offerA = supplierOfferPersistenceKey("product-1", a, "https://supplier.example/item");
  const offerB = supplierOfferPersistenceKey("product-1", a, "https://supplier.example/item");
  const offerOtherProduct = supplierOfferPersistenceKey("product-2", a, "https://supplier.example/item");
  assert.equal(offerA, offerB);
  assert.notEqual(offerA, offerOtherProduct);
});

test("supplier authorization only advances on a strictly newer verification", async () => {
  const source = await readFile("src/lib/supplier-commercialization.ts", "utf8");
  assert.match(source, /sourceVerifiedAt: \{ lt: sourceVerifiedAt \}/);
  assert.match(source, /data: \{\s*sourceVerifiedAt,\s*verificationSource: "owner_manual",\s*active: true,\s*resaleAllowed: true,/s);
  assert.match(source, /Existing authorization\/revocation state is deliberately preserved/);
  assert.doesNotMatch(source, /update: \{\s*name: supplierName,\s*websiteUrl: websiteUrl \?\? undefined,\s*active: true/s);
});

test("persisted offer economics advance atomically and reject equal-timestamp conflicts", async () => {
  const source = await readFile("src/lib/supplier-commercialization.ts", "utf8");
  assert.match(source, /prisma\.supplierOffer\.updateMany/);
  assert.match(source, /priceVerifiedAt: \{ lt: priceVerifiedAt \}/);
  assert.match(source, /if \(advanced\.count === 0\)/);
  assert.match(source, /readCurrentOffer\(initialOffer\.id\)/);
  assert.match(source, /SUPPLIER_OFFER_VERIFICATION_CONFLICT/);
  assert.match(source, /selectPersistedSupplierOffer/);
});

test("no eligible persisted supplier immediately revokes the stale direct-commerce snapshot", async () => {
  const service = await readFile("src/lib/supplier-commercialization.ts", "utf8");
  const selectionIndex = service.indexOf("if (!selection.selected)");
  const revokeIndex = service.indexOf("commerceEnabled: false", selectionIndex);
  const returnIndex = service.indexOf("prepared: null", selectionIndex);
  assert.ok(selectionIndex >= 0);
  assert.ok(revokeIndex > selectionIndex);
  assert.ok(returnIndex > revokeIndex);
  assert.match(service, /availability: unavailableSnapshotAvailability\(selection\)/);
});

test("commercialization bridge has no procurement or global commerce authority", async () => {
  const service = await readFile("src/lib/supplier-commercialization.ts", "utf8");
  const route = await readFile("src/app/api/admin/product-engine/route.ts", "utf8");
  assert.doesNotMatch(service, /stripe|checkoutSession|paymentIntent|procure|placeOrder|reserveInventory/i);
  assert.doesNotMatch(service, /COMMERCE_ENABLED\s*=/);
  assert.doesNotMatch(route, /COMMERCE_ENABLED\s*=/);
  assert.match(route, /readLimitedJson\(req, 32 \* 1024\)/);
});

test("selected persisted offer identity is carried into the derived commerce snapshot", async () => {
  const service = await readFile("src/lib/supplier-commercialization.ts", "utf8");
  assert.match(service, /persistedSupplierId/);
  assert.match(service, /persistedOfferId/);
  assert.match(service, /persistedOfferKey/);
  assert.match(service, /selected\.supplierName/);
  assert.match(service, /selected\.priceVerifiedAt\.toISOString\(\)/);
});
