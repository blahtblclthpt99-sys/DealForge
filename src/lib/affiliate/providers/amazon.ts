import {
  calcDiscount,
  type AffiliateConnector,
  type AffiliateProductInput,
  type NormalizedProduct,
} from "../types";
import { AMAZON_ASSOCIATE_TAG, buildAmazonProductUrl, withAmazonTag } from "../amazon-config";

/**
 * Amazon Associates connector for store ID: titanfieldos-20
 * Purchase links: https://www.amazon.com/dp/{ASIN}?tag=titanfieldos-20
 */
export const amazonConnector: AffiliateConnector = {
  id: "amazon",
  displayName: "Amazon Associates",

  generateLink({ asin, url }) {
    if (asin) return buildAmazonProductUrl(asin);
    if (url) return withAmazonTag(url);
    return `https://www.amazon.com/?tag=${AMAZON_ASSOCIATE_TAG}`;
  },

  async fetchProducts(query) {
    // Production: Amazon Product Advertising API 5.0
    if (!process.env.AMAZON_ACCESS_KEY || !process.env.AMAZON_SECRET_KEY) {
      return [];
    }
    void query;
    return [];
  },

  normalize(input: AffiliateProductInput): NormalizedProduct {
    const originalPrice = input.originalPrice ?? input.price;
    const price = input.price;
    return {
      asin: input.asin ?? null,
      externalId: input.asin ?? input.externalId ?? null,
      title: input.title,
      description: input.description ?? "",
      brand: input.brand ?? "Amazon",
      price,
      originalPrice,
      discountPercent: calcDiscount(price, originalPrice),
      rating: input.rating ?? 0,
      reviewCount: input.reviewCount ?? 0,
      images: input.images?.length
        ? input.images
        : input.asin
          ? [
              `https://m.media-amazon.com/images/P/${input.asin.toUpperCase()}.01._SCLZZZZZZZ_SX500_.jpg`,
            ]
          : ["/images/placeholder-product.svg"],
      category: input.category ?? "electronics",
      availability: input.availability ?? "in_stock",
      affiliateUrl: amazonConnector.generateLink({ asin: input.asin, url: input.url }),
      retailer: "amazon",
    };
  },
};

export function amazonDpLink(asin: string) {
  return buildAmazonProductUrl(asin);
}

export { AMAZON_ASSOCIATE_TAG };
