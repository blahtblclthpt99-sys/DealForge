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

test("persisted commercialization prevents stale supplier economics from replacing newer observations", async () => {
  const source = await readFile("src/lib/supplier-commercialization.ts", "utf8");
  assert.match(source, /sourceVerifiedAt: \{ lt: sourceVerifiedAt \}/);
  assert.match(source, /currentPriceVerifiedAt < priceVerifiedAt\.getTime\(\)/);
  assert.match(source, /SUPPLIER_OFFER_VERIFICATION_CONFLICT/);
  assert.match(source, /selectPersistedSupplierOffer/);
});

test("no eligible persisted supplier leaves product economics untouched", async () => {
  const route = await readFile("src/app/api/admin/product-engine/route.ts", "utf8");
  const blockedIndex = route.indexOf("NO_ELIGIBLE_SUPPLIER_OFFER");
  const updateIndex = route.indexOf("prisma.product.update");
  assert.ok(blockedIndex >= 0);
  assert.ok(updateIndex > blockedIndex);
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
