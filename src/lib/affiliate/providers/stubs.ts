import {
  calcDiscount,
  type AffiliateConnector,
  type AffiliateProductInput,
  type AffiliateNetworkId,
  type NormalizedProduct,
} from "../types";

function stubConnector(
  id: AffiliateNetworkId,
  displayName: string,
  linkBuilder: (input: { externalId?: string | null; url?: string | null }) => string,
): AffiliateConnector {
  return {
    id,
    displayName,
    generateLink: linkBuilder,
    async fetchProducts() {
      // Enable when API credentials are configured in AffiliateProvider table
      return [];
    },
    normalize(input: AffiliateProductInput): NormalizedProduct {
      const originalPrice = input.originalPrice ?? input.price;
      return {
        asin: null,
        externalId: input.externalId ?? null,
        title: input.title,
        description: input.description ?? "",
        brand: input.brand ?? displayName,
        price: input.price,
        originalPrice,
        discountPercent: calcDiscount(input.price, originalPrice),
        rating: input.rating ?? 0,
        reviewCount: input.reviewCount ?? 0,
        images: input.images?.length ? input.images : ["/images/placeholder-product.svg"],
        category: input.category ?? "electronics",
        availability: input.availability ?? "in_stock",
        affiliateUrl: linkBuilder({ externalId: input.externalId, url: input.url }),
        retailer: id,
      };
    },
  };
}

export const walmartConnector = stubConnector("walmart", "Walmart Creator", ({ externalId, url }) => {
  const base = url || (externalId ? `https://www.walmart.com/ip/${externalId}` : "https://www.walmart.com");
  return base; // Append publisher ID when credentials configured
});

export const cjConnector = stubConnector("cj", "CJ Affiliate", ({ url }) => url || "https://www.cj.com");

export const impactConnector = stubConnector("impact", "Impact.com", ({ url }) => url || "https://impact.com");

export const awinConnector = stubConnector("awin", "Awin", ({ url }) => url || "https://www.awin.com");

export const rakutenConnector = stubConnector("rakuten", "Rakuten Advertising", ({ url }) =>
  url || "https://rakutenadvertising.com",
);

export const shareasaleConnector = stubConnector("shareasale", "ShareASale", ({ url }) =>
  url || "https://www.shareasale.com",
);

export const etsyConnector = stubConnector("etsy", "Etsy Creator Collective", ({ externalId, url }) => {
  return url || (externalId ? `https://www.etsy.com/listing/${externalId}` : "https://www.etsy.com");
});
