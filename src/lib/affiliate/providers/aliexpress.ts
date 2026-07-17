import {
  calcDiscount,
  type AffiliateConnector,
  type AffiliateProductInput,
  type NormalizedProduct,
} from "../types";
import {
  buildAliExpressAffiliateUrl,
  isAliExpressConfigured,
} from "../aliexpress-config";

/**
 * AliExpress Affiliate / Portals connector.
 */
export const aliexpressConnector: AffiliateConnector = {
  id: "aliexpress",
  displayName: "AliExpress Affiliate",

  generateLink({ asin, externalId, url }) {
    return buildAliExpressAffiliateUrl({
      productId: externalId || asin,
      url,
    });
  },

  async fetchProducts() {
    if (!isAliExpressConfigured()) return [];
    return [];
  },

  normalize(input: AffiliateProductInput): NormalizedProduct {
    const originalPrice = input.originalPrice ?? input.price;
    const productId = input.externalId || input.asin || null;
    return {
      asin: null,
      externalId: productId,
      title: input.title,
      description: input.description ?? "",
      brand: input.brand ?? "AliExpress",
      price: input.price,
      originalPrice,
      discountPercent: calcDiscount(input.price, originalPrice),
      rating: input.rating ?? 0,
      reviewCount: input.reviewCount ?? 0,
      images: input.images?.length ? input.images : ["/images/placeholder-product.svg"],
      category: input.category ?? "electronics",
      availability: input.availability ?? "in_stock",
      affiliateUrl: buildAliExpressAffiliateUrl({
        productId,
        url: input.url,
        query: input.title,
      }),
      retailer: "aliexpress",
    };
  },
};
