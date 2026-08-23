import { checkCheckoutExposure, type CheckoutExposureReason } from "./checkout-exposure";
import { checkDirectCommerceProductSafety } from "./commerce-runtime-safety";

export type PendingCheckoutSafetyReason =
  | "SAFE"
  | "ORDER_INVALID"
  | "PRODUCT_MISSING"
  | "PRODUCT_UNSAFE"
  | "FINANCIAL_DRIFT"
  | "CURRENCY_DRIFT"
  | "ORDER_TOTAL_DRIFT"
  | "EXPOSURE_LIMIT";

export type PendingCheckoutItem = {
  productId: string;
  quantity: number;
  unitPriceCents: number;
  landedCostCents: number | null;
};

export type PendingCheckoutProduct = {
  id: string;
  commerceEnabled: boolean;
  availability: string;
  currency: string;
  landedCostCents: number | null;
  sellingPriceCents: number | null;
  specifications: unknown;
  retailer: string;
  affiliateUrl: string;
  asin: string | null;
};

export type PendingCheckoutSafetyInput = {
  currency: string;
  totalCents: number;
  items: PendingCheckoutItem[];
  products: PendingCheckoutProduct[];
  financialGateCertified: boolean;
  nowMs?: number;
};

export type PendingCheckoutSafetyResult = {
  safe: boolean;
  reason: PendingCheckoutSafetyReason;
  detail: string | null;
};

function blocked(reason: PendingCheckoutSafetyReason, detail: string | null = null): PendingCheckoutSafetyResult {
  return { safe: false, reason, detail };
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function checkPendingCheckoutSafety(input: PendingCheckoutSafetyInput): PendingCheckoutSafetyResult {
  const currency = input.currency.trim().toLowerCase();
  if (currency !== "usd" || !positiveSafeInteger(input.totalCents) || !Array.isArray(input.items) || input.items.length === 0) {
    return blocked("ORDER_INVALID");
  }

  const productById = new Map(input.products.map((product) => [product.id, product]));
  const exposureLines = [];

  for (const item of input.items) {
    if (
      !item.productId
      || !positiveSafeInteger(item.quantity)
      || !positiveSafeInteger(item.unitPriceCents)
      || !positiveSafeInteger(item.landedCostCents)
    ) {
      return blocked("ORDER_INVALID");
    }

    const product = productById.get(item.productId);
    if (!product) return blocked("PRODUCT_MISSING");

    const safety = checkDirectCommerceProductSafety({
      financialGateCertified: input.financialGateCertified,
      commerceEnabled: product.commerceEnabled,
      availability: product.availability,
      currency: product.currency,
      landedCostCents: product.landedCostCents,
      sellingPriceCents: product.sellingPriceCents,
      specifications: product.specifications,
      retailer: product.retailer,
      sourceUrl: product.affiliateUrl,
      asin: product.asin,
      nowMs: input.nowMs,
    });
    if (!safety.safe) return blocked("PRODUCT_UNSAFE", safety.reason);

    if (item.unitPriceCents !== product.sellingPriceCents || item.landedCostCents !== product.landedCostCents) {
      return blocked("FINANCIAL_DRIFT");
    }
    if (currency !== product.currency.trim().toLowerCase()) return blocked("CURRENCY_DRIFT");

    exposureLines.push({
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      landedCostCents: item.landedCostCents,
    });
  }

  const exposure = checkCheckoutExposure(exposureLines);
  if (!exposure.eligible) {
    return blocked("EXPOSURE_LIMIT", exposure.reason satisfies CheckoutExposureReason);
  }
  if (exposure.customerTotalCents !== input.totalCents) return blocked("ORDER_TOTAL_DRIFT");

  return { safe: true, reason: "SAFE", detail: null };
}
