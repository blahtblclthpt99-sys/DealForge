import assert from "node:assert/strict";
import test from "node:test";
import type { ProductDTO } from "../src/lib/products";
import {
  hasFreshVerifiedStock,
  isInternalCertificationProduct,
  isPublicCatalogProduct,
  publicCatalogItems,
} from "../src/lib/public-catalog";

const NOW = Date.parse("2026-08-24T21:30:00Z");

function product(overrides: Partial<ProductDTO> = {}): ProductDTO {
  return {
    id: "p1",
    asin: "B000000001",
    slug: "sample-product",
    title: "Sample Product",
    description: "Sample description",
    brand: "Sample",
    categoryId: "c1",
    categorySlug: "electronics",
    categoryName: "Electronics",
    subcategory: null,
    images: ["/images/placeholder-product.svg"],
    quantity: 1,
    price: 25,
    originalPrice: 25,
    discountPercent: 0,
    rating: 0,
    reviewCount: 0,
    affiliateUrl: "https://example.com/product",
    retailer: "amazon",
    availability: "unknown",
    availabilityVerified: false,
    priceVerified: false,
    metadataVerified: false,
    priceSource: null,
    priceVerifiedAt: null,
    metadataSource: null,
    metadataVerifiedAt: null,
    specifications: {},
    trendingScore: 0,
    clickCount: 0,
    viewCount: 0,
    isFeatured: false,
    isFlashDeal: false,
    flashEndsAt: null,
    lastUpdated: "2026-08-24T20:30:00.000Z",
    createdAt: "2026-08-24T20:00:00.000Z",
    rankScore: 0,
    purchaseMode: "affiliate",
    commerceReady: false,
    currency: "usd",
    ...overrides,
  };
}

test("internal certification products never enter the public catalog", () => {
  const byId = product({ id: "cert_test_75c_20260822_v2" });
  const byTitle = product({ id: "p2", title: "DealForge Stripe Certification — Authorized Test Only" });
  assert.equal(isInternalCertificationProduct(byId), true);
  assert.equal(isInternalCertificationProduct(byTitle), true);
  assert.equal(isPublicCatalogProduct(byId), false);
});

test("known out-of-stock products are hidden from public grids", () => {
  const row = product({ availability: "out_of_stock", availabilityVerified: true });
  assert.equal(isPublicCatalogProduct(row), false);
  assert.deepEqual(publicCatalogItems([row]), []);
});

test("commerce-ready direct products can show current in-stock state", () => {
  const row = product({
    retailer: "dealforge",
    purchaseMode: "direct",
    commerceReady: true,
    availability: "in_stock",
    availabilityVerified: true,
  });
  assert.equal(hasFreshVerifiedStock(row, NOW), true);
});

test("unverified retailer inventory never shows as fresh stock", () => {
  const row = product({ availability: "in_stock", availabilityVerified: false });
  assert.equal(hasFreshVerifiedStock(row, NOW), false);
});

test("verified affiliate inventory becomes stale after the freshness window", () => {
  const fresh = product({
    retailer: "example-retailer",
    availability: "in_stock",
    availabilityVerified: true,
    lastUpdated: "2026-08-24T20:30:00.000Z",
  });
  const stale = product({
    retailer: "example-retailer",
    availability: "in_stock",
    availabilityVerified: true,
    lastUpdated: "2026-08-20T20:30:00.000Z",
  });
  assert.equal(hasFreshVerifiedStock(fresh, NOW), true);
  assert.equal(hasFreshVerifiedStock(stale, NOW), false);
});
