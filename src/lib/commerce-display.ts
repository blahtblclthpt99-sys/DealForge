import type { ProductDTO } from "@/lib/products";

const AMAZON_PRICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TRUSTED_AMAZON_PRICE_SOURCES = new Set([
  "amazon-creators-api",
  "amazon-pa-api",
  "amazon-data-feed",
]);

type PriceStatus = "current" | "recorded" | "unavailable";

export type CommerceDisplayState = {
  isAmazon: boolean;
  priceStatus: PriceStatus;
  priceIsFresh: boolean;
  priceNeedsCheck: boolean;
  canDisplayPrice: boolean;
  canDisplayDiscount: boolean;
  checkedDate: string | null;
  priceCaption: string;
  reviewCountIsCredible: boolean;
};

function parseDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function normalizedSource(product: Pick<ProductDTO, "specifications">) {
  const source = product.specifications?.priceSource;
  return typeof source === "string" ? source.trim().toLowerCase() : "";
}

function priceTimestamp(
  product: Pick<ProductDTO, "specifications" | "lastUpdated">,
  trustedSource: boolean,
) {
  const specs = product.specifications ?? {};
  const candidates = [
    specs.priceCheckedAt,
    specs.observedAt,
    trustedSource ? product.lastUpdated : null,
    product.lastUpdated,
  ];
  for (const candidate of candidates) {
    const parsed = parseDate(candidate);
    if (parsed != null) return parsed;
  }
  return null;
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
  const trustedSource = TRUSTED_AMAZON_PRICE_SOURCES.has(normalizedSource(product));
  const observedAt = priceTimestamp(product, trustedSource);
  const age = observedAt == null ? Number.POSITIVE_INFINITY : Math.max(0, now - observedAt);
  const validPrice = Number.isFinite(product.price) && product.price > 0;
  const priceIsFresh = !isAmazon || (trustedSource && age <= AMAZON_PRICE_MAX_AGE_MS);
  const priceStatus: PriceStatus = !validPrice
    ? "unavailable"
    : priceIsFresh
      ? "current"
      : "recorded";
  const canDisplayPrice = priceStatus !== "unavailable";
  const canDisplayDiscount =
    priceStatus === "current" &&
    Number.isFinite(product.originalPrice) &&
    product.originalPrice > product.price &&
    Number.isFinite(product.discountPercent) &&
    product.discountPercent > 0;
  const checkedDate =
    observedAt == null ? null : new Date(observedAt).toISOString().slice(0, 10);

  let priceCaption: string;
  if (priceStatus === "current") {
    priceCaption = checkedDate
      ? `Price checked ${checkedDate} · verify final price at checkout`
      : "Current recorded price · verify final price at checkout";
  } else if (priceStatus === "recorded") {
    priceCaption = checkedDate
      ? `Recorded ${checkedDate} · check Amazon for today’s price`
      : "Recorded catalog price · check Amazon for today’s price";
  } else {
    priceCaption = isAmazon
      ? "Check Amazon for current price and availability"
      : "Check retailer for current price and availability";
  }

  return {
    isAmazon,
    priceStatus,
    priceIsFresh,
    priceNeedsCheck: priceStatus !== "current",
    canDisplayPrice,
    canDisplayDiscount,
    checkedDate,
    priceCaption,
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
