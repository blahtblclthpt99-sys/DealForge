import assert from "node:assert/strict";
import test from "node:test";
import { getCommerceDisplayState } from "../src/lib/commerce-display";
import type { ProductDTO } from "../src/lib/products";

function product(overrides: Partial<ProductDTO> = {}): ProductDTO {
  return {
    id: "p1",
    asin: "B000000001",
    slug: "test-product",
    title: "Test Product",
    description: "Test",
    brand: "Brand",
    categoryId: "c1",
    subcategory: null,
    images: ["/images/placeholder-product.svg"],
    quantity: 1,
    price: 9.99,
    originalPrice: 12.99,
    discountPercent: 23,
    recordedPrice: 9.99,
    recordedPriceAvailable: false,
    rating: 4.5,
    reviewCount: 10,
    affiliateUrl: "https://example.com/source",
    retailer: "amazon",
    availability: "in_stock",
    commerceEnabled: false,
    sellingPriceCents: null,
    currency: "usd",
    specifications: {
      priceSource: "amazon-creators-api",
      priceCheckedAt: "2026-08-22T20:00:00.000Z",
    },
    trendingScore: 0,
    clickCount: 0,
    viewCount: 0,
    isFeatured: false,
    isFlashDeal: false,
    flashEndsAt: null,
    lastUpdated: "2026-08-22T20:00:00.000Z",
    createdAt: "2026-08-22T19:00:00.000Z",
    rankScore: 0,
    ...overrides,
  };
}

test("direct commerce uses DealForge selling cents instead of supplier price", () => {
  const state = getCommerceDisplayState(product({
    commerceEnabled: true,
    sellingPriceCents: 1599,
    price: 9.99,
    specifications: {
      commerceRecommendation: { assessedAt: "2026-08-22T21:00:00.000Z" },
    },
  }), Date.parse("2026-08-22T21:05:00.000Z"));

  assert.equal(state.isDirectCommerce, true);
  assert.equal(state.canPurchaseDirect, true);
  assert.equal(state.sellerLabel, "DealForge");
  assert.equal(state.displayPrice, 15.99);
  assert.equal(state.canDisplayDiscount, false);
  assert.match(state.priceCaption, /DealForge selling price/);
});

test("direct commerce fails closed when selling price is invalid", () => {
  const state = getCommerceDisplayState(product({ commerceEnabled: true, sellingPriceCents: null }));
  assert.equal(state.isDirectCommerce, true);
  assert.equal(state.canPurchaseDirect, false);
  assert.equal(state.canDisplayPrice, false);
  assert.equal(state.displayPrice, null);
  assert.equal(state.priceStatus, "unavailable");
});

test("direct commerce fails closed when product is out of stock", () => {
  const state = getCommerceDisplayState(product({
    commerceEnabled: true,
    sellingPriceCents: 1599,
    availability: "out_of_stock",
  }));
  assert.equal(state.canPurchaseDirect, false);
  assert.equal(state.displayPrice, null);
});

test("legacy retailer listings retain retailer price behavior when direct commerce is off", () => {
  const now = Date.parse("2026-08-22T21:00:00.000Z");
  const state = getCommerceDisplayState(product(), now);
  assert.equal(state.isDirectCommerce, false);
  assert.equal(state.canPurchaseDirect, false);
  assert.equal(state.sellerLabel, "Amazon");
  assert.equal(state.displayPrice, 9.99);
  assert.equal(state.canDisplayDiscount, true);
});
