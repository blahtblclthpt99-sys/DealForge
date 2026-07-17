export type AffiliateNetworkId =
  | "amazon"
  | "walmart"
  | "ebay"
  | "aliexpress"
  | "cj"
  | "impact"
  | "awin"
  | "rakuten"
  | "shareasale"
  | "etsy";

export type AffiliateProductInput = {
  asin?: string | null;
  externalId?: string | null;
  title: string;
  description?: string;
  brand?: string;
  price: number;
  originalPrice?: number;
  rating?: number;
  reviewCount?: number;
  images?: string[];
  category?: string;
  availability?: string;
  url?: string;
};

export type NormalizedProduct = {
  asin: string | null;
  externalId: string | null;
  title: string;
  description: string;
  brand: string;
  price: number;
  originalPrice: number;
  discountPercent: number;
  rating: number;
  reviewCount: number;
  images: string[];
  category: string;
  availability: string;
  affiliateUrl: string;
  retailer: AffiliateNetworkId;
};

export interface AffiliateConnector {
  id: AffiliateNetworkId;
  displayName: string;
  /** Generate a tracked affiliate purchase URL for this network */
  generateLink(input: {
    asin?: string | null;
    externalId?: string | null;
    url?: string | null;
  }): string;
  /** Optional remote product retrieval (PA-API, partner APIs, etc.) */
  fetchProducts?(
    query: string,
    options?: { page?: number; category?: string },
  ): Promise<AffiliateProductInput[]>;
  normalize(input: AffiliateProductInput): NormalizedProduct;
}

export function calcDiscount(price: number, originalPrice: number) {
  if (!originalPrice || originalPrice <= price) return 0;
  return Math.round(((originalPrice - price) / originalPrice) * 1000) / 10;
}
