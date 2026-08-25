import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public inventory hydration batch-loads only the latest observation per exact offer", async () => {
  const source = await readFile("src/lib/inventory-observation-store.ts", "utf8");
  assert.match(source, /readLatestInventoryObservations/);
  assert.match(source, /slice\(0, 250\)/);
  assert.match(source, /ROW_NUMBER\(\) OVER/);
  assert.match(source, /PARTITION BY "supplierOfferId"/);
  assert.match(source, /Prisma\.join\(ids\)/);
});

test("storefront reuses checkout persisted-offer binding and stays read-only", async () => {
  const source = await readFile("src/lib/storefront-inventory.ts", "utf8");
  assert.match(source, /evaluatePersistedOfferBinding/);
  assert.match(source, /readLatestInventoryObservations/);
  assert.match(source, /prisma\.supplierOffer\.findMany/);
  assert.match(source, /bindingAllowed: binding\.allowed/);
  assert.match(source, /availabilityVerified: binding\.allowed && observedAvailability === "in_stock"/);
  assert.doesNotMatch(source, /prisma\.(?:product|supplierOffer)\.(?:update|updateMany|create|delete)/);
});

test("public direct-commerce claims require current exact inventory binding", async () => {
  const source = await readFile("src/lib/products.ts", "utf8");
  assert.match(source, /inventoryDecision\?\.bindingAllowed === true/);
  assert.match(source, /inventoryDecision\.availabilityVerified/);
  assert.match(source, /readStorefrontInventoryDecisions/);
  assert.match(source, /catch \{[\s\S]*under-claim availability and direct-commerce readiness/);
  assert.match(source, /availabilityVerified: direct && inventoryDecision\.availabilityVerified/);
  assert.match(source, /inventoryVerifiedAt:/);
  assert.match(source, /inventoryExpiresAt:/);
});

test("positive direct inventory claims are not cached beyond their evidence window", async () => {
  const source = await readFile("src/lib/products.ts", "utf8");
  assert.match(source, /products:v14:/);
  assert.match(source, /if \(!items\.some\(\(item\) => item\.commerceReady\)\) await cacheSet\(cacheKey, result, 45\)/);
});

test("default ranking favors currently verified DealForge inventory without overriding explicit sorting", async () => {
  const source = await readFile("src/lib/products.ts", "utf8");
  assert.match(source, /computeRankScore\(dtoBase\) \+ \(direct \? 0\.35 : 0\)/);
  assert.match(source, /if \(params\.sort \|\| params\.trending \|\| params\.newest\) return items/);
  assert.match(source, /Number\(right\.commerceReady\) - Number\(left\.commerceReady\)/);
});

test("product cards reserve in-stock DealForge claims for verified direct inventory", async () => {
  const source = await readFile("src/components/product-card.tsx", "utf8");
  assert.match(source, /verifiedInStock = direct && product\.availabilityVerified && product\.availability === "in_stock"/);
  assert.match(source, /In stock · Sold by DealForge/);
  assert.match(source, /Check price &amp; availability at source/);
  assert.match(source, /\{direct \? \([\s\S]*QuickAddButton/);
});
