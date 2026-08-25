import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { productClaimIntegrity } from "../src/lib/products";

const NOW = Date.parse("2026-08-25T01:15:00Z");

test("Amazon claims still require authorized fresh provenance", () => {
  const trusted = productClaimIntegrity({
    retailer: "amazon",
    priceSource: "amazon_owner_verified",
    priceVerifiedAt: new Date("2026-08-25T00:30:00Z"),
    metadataSource: "amazon_owner_verified",
    metadataVerifiedAt: new Date("2026-08-24T20:00:00Z"),
  }, NOW);
  assert.equal(trusted.priceVerified, true);
  assert.equal(trusted.metadataVerified, true);

  const stale = productClaimIntegrity({
    retailer: "amazon",
    priceSource: "amazon_owner_verified",
    priceVerifiedAt: new Date("2026-08-23T00:00:00Z"),
    metadataSource: "amazon_owner_verified",
    metadataVerifiedAt: new Date("2026-08-10T00:00:00Z"),
  }, NOW);
  assert.equal(stale.priceVerified, false);
  assert.equal(stale.metadataVerified, false);
});

test("non-Amazon retailer claims are not implicitly verified", () => {
  const missing = productClaimIntegrity({
    retailer: "walmart",
    priceSource: null,
    priceVerifiedAt: null,
    metadataSource: null,
    metadataVerifiedAt: null,
  }, NOW);
  assert.equal(missing.priceVerified, false);
  assert.equal(missing.metadataVerified, false);

  const recent = productClaimIntegrity({
    retailer: "walmart",
    priceSource: "owner_verified",
    priceVerifiedAt: new Date("2026-08-25T00:30:00Z"),
    metadataSource: "owner_verified",
    metadataVerifiedAt: new Date("2026-08-24T20:00:00Z"),
  }, NOW);
  assert.equal(recent.priceVerified, true);
  assert.equal(recent.metadataVerified, true);
});

test("non-Amazon metadata expires within a conservative public freshness window", () => {
  const stale = productClaimIntegrity({
    retailer: "target",
    priceSource: "owner_verified",
    priceVerifiedAt: new Date("2026-08-23T00:00:00Z"),
    metadataSource: "owner_verified",
    metadataVerifiedAt: new Date("2026-08-22T00:00:00Z"),
  }, NOW);
  assert.equal(stale.priceVerified, false);
  assert.equal(stale.metadataVerified, false);
});

test("public query policy is scope-aware and filters before pagination", async () => {
  const source = await readFile("src/lib/products.ts", "utf8");
  assert.match(source, /export function publicCatalogWhere/);
  assert.match(source, /isCertificationCatalogMode\(\)/);
  assert.match(source, /id: \{ in: \[\.\.\.CERTIFICATION_CATALOG_PRODUCT_IDS\] \}/);
  assert.match(source, /availability: \{ not: "out_of_stock" \}/);
  assert.match(source, /startsWith: "cert_"/);
  assert.match(source, /internalCertification/);
  assert.match(source, /needsEnrichment/);
  assert.match(source, /const where: Prisma\.ProductWhereInput = publicCatalogWhere\(\)/);
  assert.match(source, /prisma\.product\.count\(\{ where \}\)/);
});

test("related products, categories, and brands reuse the same scoped public policy", async () => {
  const source = await readFile("src/lib/products.ts", "utf8");
  assert.match(source, /AND: \[publicCatalogWhere\(\), \{ categoryId:/);
  assert.match(source, /AND: \[publicCatalogWhere\(\), \{ brand:/);
  assert.match(source, /products: \{ where: publicCatalogWhere\(\) \}/);
  assert.match(source, /groupBy\(\{ where: publicCatalogWhere\(\)/);
});

test("detail lookup stays inside the active catalog scope", async () => {
  const source = await readFile("src/lib/products.ts", "utf8");
  assert.match(source, /findFirst\([\s\S]*publicCatalogWhere\(\)[\s\S]*slug/);
  assert.match(source, /if \(isCertificationCatalogMode\(\)\)/);
  assert.match(source, /isCertificationCatalogProduct\(product\)/);
  assert.match(source, /!internalCertificationRecord\(product\)/);
});

test("estimated prices are never labeled verified retailer prices", async () => {
  const source = await readFile("src/lib/products.ts", "utf8");
  assert.match(source, /priceVerified: direct \|\| \(!priceEstimated && integrity\.priceVerified\)/);
  assert.match(source, /priceSource: direct \? "dealforge" : priceEstimated \? "dealforge_estimate"/);
});

test("catalog caches are versioned and certification scope-aware", async () => {
  const source = await readFile("src/lib/products.ts", "utf8");
  assert.match(source, /certificationCatalogScopeKey\(\)/);
  assert.match(source, /products:v13:\$\{scope\}:/);
  assert.match(source, /products:count:v7:\$\{scope\}:/);
  assert.match(source, /categories:public:v3:\$\{scope\}/);
  assert.match(source, /brands:public:v3:\$\{scope\}:/);
});
