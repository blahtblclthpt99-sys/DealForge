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
  isDirectCommerce: boolean;
  canPurchaseDirect: boolean;
  sellerLabel: string;
  displayPrice: number | null;
  displayCurrency: string;
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
    trustedSource ? product.lastUpdated : null,
    specs.observedAt,
  ];
  for (const candidate of candidates) {
    const parsed = parseDate(candidate);
    if (parsed != null) return parsed;
  }
  return null;
}

function directRecommendationTimestamp(product: Pick<ProductDTO, "specifications">) {
  const recommendation = product.specifications?.commerceRecommendation;
  if (!recommendation || typeof recommendation !== "object" || Array.isArray(recommendation)) return null;
  return parseDate((recommendation as Record<string, unknown>).assessedAt);
}

export function getCommerceDisplayState(
  product: Pick<
    ProductDTO,
    | "retailer"
    | "lastUpdated"
    | "price"
    | "originalPrice"
    | "discountPercent"
    | "recordedPriceAvailable"
    | "reviewCount"
    | "specifications"
    | "commerceEnabled"
    | "sellingPriceCents"
    | "currency"
    | "availability"
  >,
  now = Date.now(),
): CommerceDisplayState {
  const isAmazon = product.retailer.trim().toLowerCase() === "amazon";
  const currency = product.currency.trim().toLowerCase();
  const isDirectCommerce = product.commerceEnabled;
  const canPurchaseDirect =
    isDirectCommerce &&
    Number.isSafeInteger(product.sellingPriceCents) &&
    (product.sellingPriceCents ?? 0) > 0 &&
    /^[a-z]{3}$/.test(currency) &&
    product.availability === "in_stock";

  if (isDirectCommerce) {
    const assessedAt = directRecommendationTimestamp(product);
    return {
      isAmazon,
      isDirectCommerce: true,
      canPurchaseDirect,
      sellerLabel: "DealForge",
      displayPrice: canPurchaseDirect ? (product.sellingPriceCents as number) / 100 : null,
      displayCurrency: currency || "usd",
      priceStatus: canPurchaseDirect ? "current" : "unavailable",
      priceIsFresh: canPurchaseDirect,
      priceNeedsCheck: !canPurchaseDirect,
      canDisplayPrice: canPurchaseDirect,
      canDisplayDiscount: false,
      checkedDate: assessedAt == null ? null : new Date(assessedAt).toISOString().slice(0, 10),
      priceCaption: canPurchaseDirect
        ? "DealForge selling price · final order amount is validated again at secure checkout"
        : "Temporarily unavailable from DealForge",
      reviewCountIsCredible: product.reviewCount > 0 && !(isAmazon && product.reviewCount === 100),
    };
  }

  const trustedSource = TRUSTED_AMAZON_PRICE_SOURCES.has(normalizedSource(product));
  const observedAt = priceTimestamp(product, trustedSource);
  const age = observedAt == null ? Number.POSITIVE_INFINITY : Math.max(0, now - observedAt);
  const validPublicPrice = Number.isFinite(product.price) && product.price > 0;
  const priceIsFresh = !isAmazon || (trustedSource && age <= AMAZON_PRICE_MAX_AGE_MS);
  const priceStatus: PriceStatus = validPublicPrice && priceIsFresh
    ? "current"
    : isAmazon && product.recordedPriceAvailable
      ? "recorded"
      : "unavailable";

  const canDisplayPrice = validPublicPrice && (!isAmazon || priceStatus === "current");
  const canDisplayDiscount =
    canDisplayPrice &&
    priceStatus === "current" &&
    Number.isFinite(product.originalPrice) &&
    product.originalPrice > product.price &&
    Number.isFinite(product.discountPercent) &&
    product.discountPercent > 0;
  const checkedDate =
    observedAt == null ? null : new Date(observedAt).toISOString().slice(0, 10);

  let priceCaption: string;
  if (canDisplayPrice && priceStatus === "current") {
    priceCaption = checkedDate
      ? `Price checked ${checkedDate} · verify final price at retailer checkout`
      : "Price recently checked · verify final price at retailer checkout";
  } else if (isAmazon && priceStatus === "recorded") {
    priceCaption = "Current Amazon price is not verified yet · check Amazon for today’s price";
  } else {
    priceCaption = isAmazon
      ? "Check Amazon for current price and availability"
      : "Check retailer for current price and availability";
  }

  return {
    isAmazon,
    isDirectCommerce: false,
    canPurchaseDirect: false,
    sellerLabel: retailerLabel(product.retailer),
    displayPrice: canDisplayPrice ? product.price : null,
    displayCurrency: currency || "usd",
    priceStatus,
    priceIsFresh,
    priceNeedsCheck: !canDisplayPrice || priceStatus !== "current",
    canDisplayPrice,
    canDisplayDiscount,
    checkedDate,
    priceCaption,
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
