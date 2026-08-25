import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CERTIFICATION_CATALOG_PRODUCT_IDS,
  isCertificationCatalogId,
} from "../src/lib/certification-catalog";
import { calculateCustomerFriendlyPrice } from "../src/lib/cart-pricing";

test("certification catalog is a small explicit allowlist", () => {
  assert.equal(CERTIFICATION_CATALOG_PRODUCT_IDS.length, 7);
  assert.equal(new Set(CERTIFICATION_CATALOG_PRODUCT_IDS).size, 7);
  for (const id of CERTIFICATION_CATALOG_PRODUCT_IDS) assert.equal(isCertificationCatalogId(id), true);
  assert.equal(isCertificationCatalogId("ordinary-production-product"), false);
});

test("certification storefront defaults closed around the allowlist", async () => {
  const source = await readFile("src/lib/certification-catalog.ts", "utf8");
  const products = await readFile("src/lib/products.ts", "utf8");
  assert.match(source, /process\.env\.NODE_ENV === "production"/);
  assert.match(products, /id: \{ in: \[\.\.\.CERTIFICATION_CATALOG_PRODUCT_IDS\] \}/);
  assert.match(products, /findFirst\([\s\S]*publicCatalogWhere\(\)[\s\S]*slug/);
  assert.match(products, /certificationCatalogScopeKey\(\)/);
});

test("cart quote and add-ons reject parked catalog products in certification mode", async () => {
  const quote = await readFile("src/app/api/cart/quote/route.ts", "utf8");
  const addons = await readFile("src/app/api/cart/addons/route.ts", "utf8");
  assert.match(quote, /PRODUCT_NOT_IN_CERTIFICATION_CATALOG/);
  assert.match(quote, /products\.every\(isCertificationCatalogProduct\)/);
  assert.match(addons, /PRODUCT_NOT_IN_CERTIFICATION_CATALOG/);
  assert.match(addons, /CERTIFICATION_CATALOG_PRODUCT_IDS/);
  assert.match(addons, /notIn: cartIds/);
});

test("certification checkout is test-mode-only and still runs pricing", async () => {
  const checkout = await readFile("src/app/api/checkout/route.ts", "utf8");
  assert.match(checkout, /CERTIFICATION_REQUIRES_TEST_MODE/);
  assert.match(checkout, /catalogCertificationOnly/);
  assert.match(checkout, /evaluateCertificationCommerceGate/);
  assert.match(checkout, /attributableCostFromSpecifications/);
  assert.match(checkout, /calculateCustomerFriendlyPrice/);
  assert.match(checkout, /PRODUCT_NOT_IN_CERTIFICATION_CATALOG/);
  assert.match(checkout, /cardOnly: certificationOnly && isStripeTestMode\(\)/);
});

test("certification product pages never fall back to an external source checkout", async () => {
  const productPage = await readFile("src/app/product/[slug]/page.tsx", "utf8");
  assert.match(productPage, /product\.retailer === "dealforge-test"/);
  assert.match(productPage, /direct \|\| !certificationProduct/);
  assert.match(productPage, /!direct && !certificationProduct/);
  assert.match(productPage, /This internal certification item has no external source checkout/);
});

test("planned certification prices remain above canonical safe floors", () => {
  const fixtures = [
    { id: "home-main", landed: 1800, published: 2499 },
    { id: "home-addon-1", landed: 250, published: 549 },
    { id: "home-addon-2", landed: 350, published: 699 },
    { id: "auto-main", landed: 2200, published: 2999 },
    { id: "auto-addon-1", landed: 200, published: 499 },
    { id: "office-main", landed: 800, published: 1299 },
    { id: "office-addon-1", landed: 100, published: 399 },
  ];
  for (const fixture of fixtures) {
    const result = calculateCustomerFriendlyPrice({
      landedCostCents: fixture.landed,
      publishedPriceCents: fixture.published,
    });
    assert.equal(result.eligible, true, fixture.id);
    assert.ok(result.customerPriceCents <= fixture.published, fixture.id);
    assert.ok(result.estimatedContributionProfitCents >= result.minimumProfitCents, fixture.id);
  }
});
