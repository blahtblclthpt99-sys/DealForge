import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AMAZON_METADATA_MAX_AGE_MS,
  AMAZON_PRICE_MAX_AGE_MS,
  AUTHORIZED_AMAZON_METADATA_SOURCES,
  AUTHORIZED_AMAZON_PRICE_SOURCES,
  DIRECT_RESALE_SOURCE_CLASSES,
  isAuthorizedAmazonMetadataSource,
  isAuthorizedAmazonPriceSource,
  isDirectResaleSourceClass,
  isFreshVerification,
} from "../src/lib/source-policy";

test("direct-resale source policy is explicit and rejects affiliate-only sources", () => {
  assert.deepEqual(DIRECT_RESALE_SOURCE_CLASSES, [
    "manufacturer",
    "wholesale",
    "distributor",
    "authorized_dropshipper",
    "retailer_permitting_resale",
  ]);
  for (const sourceClass of DIRECT_RESALE_SOURCE_CLASSES) assert.equal(isDirectResaleSourceClass(sourceClass), true);
  assert.equal(isDirectResaleSourceClass("affiliate_only"), false);
  assert.equal(isDirectResaleSourceClass("manual"), false);
});

test("Amazon price and metadata authority use one explicit trusted policy", () => {
  assert.deepEqual(AUTHORIZED_AMAZON_PRICE_SOURCES, [
    "amazon_creators_api",
    "amazon_authorized_api",
    "amazon_owner_verified",
  ]);
  assert.deepEqual(AUTHORIZED_AMAZON_METADATA_SOURCES, AUTHORIZED_AMAZON_PRICE_SOURCES);
  for (const source of AUTHORIZED_AMAZON_PRICE_SOURCES) assert.equal(isAuthorizedAmazonPriceSource(source), true);
  for (const source of AUTHORIZED_AMAZON_METADATA_SOURCES) assert.equal(isAuthorizedAmazonMetadataSource(source), true);
  assert.equal(isAuthorizedAmazonPriceSource("public_reference"), false);
  assert.equal(isAuthorizedAmazonMetadataSource("owner_asin"), false);
});

test("verification freshness rejects future and stale timestamps", () => {
  const now = Date.parse("2026-08-24T22:30:00Z");
  assert.equal(isFreshVerification(new Date(now - AMAZON_PRICE_MAX_AGE_MS), AMAZON_PRICE_MAX_AGE_MS, now), true);
  assert.equal(isFreshVerification(new Date(now - AMAZON_PRICE_MAX_AGE_MS - 1), AMAZON_PRICE_MAX_AGE_MS, now), false);
  assert.equal(isFreshVerification(new Date(now + 1), AMAZON_PRICE_MAX_AGE_MS, now), false);
  assert.equal(isFreshVerification(new Date(now - AMAZON_METADATA_MAX_AGE_MS), AMAZON_METADATA_MAX_AGE_MS, now), true);
});

test("commerce, commercialization, storefront, worker, and supplier selector share source-policy", async () => {
  const paths = [
    "src/lib/commerce-gate.ts",
    "src/lib/commercialization.ts",
    "src/lib/products.ts",
    "src/workers/index.ts",
    "src/lib/supplier-offers.ts",
  ];
  const sources = await Promise.all(paths.map((path) => readFile(path, "utf8")));
  for (const source of sources) assert.match(source, /source-policy/);

  const [gate, commercialization, products, worker, supplierOffers] = sources;
  assert.match(gate, /isDirectResaleSourceClass/);
  assert.match(commercialization, /isDirectResaleSourceClass/);
  assert.match(products, /isAuthorizedAmazonPriceSource/);
  assert.match(worker, /isAuthorizedAmazonPriceSource/);
  assert.match(supplierOffers, /isDirectResaleSourceClass/);

  for (const source of [gate, products, worker, supplierOffers]) {
    assert.doesNotMatch(source, /new Set\(\["amazon_creators_api"/);
    assert.doesNotMatch(source, /new Set\(\[\s*"manufacturer"/);
  }
});
