import {
  calcDiscount,
  type AffiliateConnector,
  type AffiliateProductInput,
  type NormalizedProduct,
} from "../types";
import {
  buildEbayAffiliateUrl,
  EBAY_AFFILIATE_SID,
  isEbayAffiliateConfigured,
} from "../ebay-config";

/**
 * eBay Partner Network connector.
 * Generates tracked purchase links using your affiliate SID.
 */
export const ebayConnector: AffiliateConnector = {
  id: "ebay",
  displayName: "eBay Partner Network",

  generateLink({ asin, externalId, url }) {
    const itemId = externalId || asin;
    return buildEbayAffiliateUrl({ itemId, url });
  },

  async fetchProducts() {
    // Browse API / Finding API can be wired here when OAuth app credentials are added
    if (!isEbayAffiliateConfigured()) return [];
    return [];
  },

  normalize(input: AffiliateProductInput): NormalizedProduct {
    const originalPrice = input.originalPrice ?? input.price;
    const itemId = input.externalId || input.asin || null;
    return {
      asin: null,
      externalId: itemId,
      title: input.title,
      description: input.description ?? "",
      brand: input.brand ?? "eBay",
      price: input.price,
      originalPrice,
      discountPercent: calcDiscount(input.price, originalPrice),
      rating: input.rating ?? 0,
      reviewCount: input.reviewCount ?? 0,
      images: input.images?.length ? input.images : ["/images/placeholder-product.svg"],
      category: input.category ?? "electronics",
      availability: input.availability ?? "in_stock",
      affiliateUrl: buildEbayAffiliateUrl({ itemId, url: input.url }),
      retailer: "ebay",
    };
  },
};

export function ebayItemLink(itemId: string) {
  return buildEbayAffiliateUrl({ itemId });
}

export { EBAY_AFFILIATE_SID };
