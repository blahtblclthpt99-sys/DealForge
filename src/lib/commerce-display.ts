import type { ProductDTO } from "@/lib/products";

const AMAZON_PRICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TRUSTED_AMAZON_PRICE_SOURCES = new Set([
  "amazon-creators-api",
  "amazon-pa-api",
  "amazon-data-feed",
]);

export type CommerceDisplayState = {
  isAmazon: boolean;
  priceIsFresh: boolean;
  canDisplayPrice: boolean;
  canDisplayDiscount: boolean;
  checkedDate: string | null;
  reviewCountIsCredible: boolean;
};

function parseDate(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function normalizedSource(product: Pick<ProductDTO, "specifications">) {
  const source = product.specifications?.priceSource;
  return typeof source === "string" ? source.trim().toLowerCase() : "";
}

export function getCommerceDisplayState(
  product: Pick<
    ProductDTO,
    | "retailer"
    | "lastUpdated"
    | "price"
    | "originalPrice"
    | "discountPercent"
    | "reviewCount"
    | "specifications"
  >,
  now = Date.now(),
): CommerceDisplayState {
  const isAmazon = product.retailer.trim().toLowerCase() === "amazon";
  const updatedAt = parseDate(product.lastUpdated);
  const age = updatedAt == null ? Number.POSITIVE_INFINITY : Math.max(0, now - updatedAt);
  const trustedSource = TRUSTED_AMAZON_PRICE_SOURCES.has(normalizedSource(product));
  const priceIsFresh = !isAmazon || (trustedSource && age <= AMAZON_PRICE_MAX_AGE_MS);
  const validPrice = Number.isFinite(product.price) && product.price > 0;
  const canDisplayPrice = validPrice && priceIsFresh;
  const canDisplayDiscount =
    canDisplayPrice &&
    Number.isFinite(product.originalPrice) &&
    product.originalPrice > product.price &&
    Number.isFinite(product.discountPercent) &&
    product.discountPercent > 0;

  return {
    isAmazon,
    priceIsFresh,
    canDisplayPrice,
    canDisplayDiscount,
    checkedDate: updatedAt == null ? null : new Date(updatedAt).toISOString().slice(0, 10),
    // Several legacy scrape paths used exactly 100 as a fallback review count.
    reviewCountIsCredible: product.reviewCount > 0 && !(isAmazon && product.reviewCount === 100),
  };
}

export function retailerLabel(retailer: string) {
  switch (retailer.trim().toLowerCase()) {
    case "amazon":
      return "Amazon";
    case "ebay":
      return "eBay";
    case "aliexpress":
      return "AliExpress";
    case "walmart":
      return "Walmart";
    case "etsy":
      return "Etsy";
    default:
      return retailer || "Retailer";
  }
}
