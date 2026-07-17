/**
 * Curated clothing expansion — only ASINs already verified in this catalog.
 * Prefer npm run catalog:clothing after add-asins for new items.
 */
export type ClothingCatalogItem = {
  asin: string;
  title: string;
  brand: string;
  subcategory: string;
  price: number;
  originalPrice: number;
  rating: number;
  reviewCount: number;
};

export function clothingImageUrl(asin: string) {
  return `https://m.media-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_SX500_.jpg`;
}

/** Keep empty — new clothing ASINs should be added via add-asins (live scrape). */
export const CLOTHING_EXPANSION: ClothingCatalogItem[] = [];
