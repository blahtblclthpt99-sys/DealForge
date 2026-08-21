import {
  calcDiscount,
  type AffiliateConnector,
  type AffiliateProductInput,
  type NormalizedProduct,
} from "../types";
import { AMAZON_ASSOCIATE_TAG, buildAmazonProductUrl, withAmazonTag } from "../amazon-config";
import { searchAmazonCreatorItems } from "../amazon-creators";

/**
 * Amazon Associates connector for store ID: titanfieldos-20.
 * Product data is retrieved through Amazon Creators API when credentials are configured.
 */
export const amazonConnector: AffiliateConnector = {
  id: "amazon",
  displayName: "Amazon Associates",

  generateLink({ asin, url }) {
    if (asin) return buildAmazonProductUrl(asin);
    if (url) return withAmazonTag(url);
    return `https://www.amazon.com/?tag=${AMAZON_ASSOCIATE_TAG}`;
  },

  async fetchProducts(query, options) {
    const items = await searchAmazonCreatorItems(query, options);
    return items;
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
          ? [`https://m.media-amazon.com/images/P/${input.asin.toUpperCase()}.01._SCLZZZZZZZ_SX500_.jpg`]
          : ["/images/placeholder-product.svg"],
      category: input.category ?? "electronics",
      availability: input.availability ?? "unknown",
      affiliateUrl: amazonConnector.generateLink({ asin: input.asin, url: input.url }),
      retailer: "amazon",
    };
  },
};

export function amazonDpLink(asin: string, _tag?: string) {
  void _tag;
  return buildAmazonProductUrl(asin);
}

export { AMAZON_ASSOCIATE_TAG };
