import { isDirectResaleSourceClass, type DirectResaleSourceClass } from "@/lib/source-policy";

export const MONETIZATION_MODES = ["DIRECT", "AFFILIATE", "BUNDLE", "HYBRID", "BLOCKED"] as const;
export type MonetizationMode = (typeof MONETIZATION_MODES)[number];

export const BUNDLE_ROLES = ["ANCHOR", "ATTACHMENT", "MARGIN_DRIVER", "CONVENIENCE", "PREMIUM_UPGRADE", "SUBSTITUTE"] as const;
export type BundleRole = (typeof BUNDLE_ROLES)[number];

export const BUNDLE_TIERS = ["ESSENTIAL", "BEST_VALUE", "COMPLETE"] as const;
export type BundleTier = (typeof BUNDLE_TIERS)[number];

export const MIN_BUNDLE_RELEVANCE_SCORE = 80;
export const MAX_BUNDLE_COMPONENTS = 12;

export type AffiliateProvider = "amazon" | "ebay" | "other";

export type CommercialRight = {
  sourceClass?: DirectResaleSourceClass | string | null;
  resaleAllowed?: boolean;
  affiliateAllowed?: boolean;
  affiliateProvider?: AffiliateProvider | null;
};

export type BasketComponent = {
  id: string;
  role: BundleRole;
  quantity: number;
  sellingPriceCents: number;
  landedCostCents: number;
  reserveCents: number;
  affiliateCommissionCents?: number;
  directFulfillment: boolean;
  commercialRight: CommercialRight;
};

export type BundleRelevanceInput = {
  compatibilityBps: number;
  purchaseRelationshipBps: number;
  usefulnessBps: number;
  priceAdvantageBps: number;
  marginContributionBps: number;
  supplierConfidenceBps: number;
};

export type BasketProfitInput = {
  components: BasketComponent[];
  minimumProfitCents: number;
  paymentCostCents?: number;
  shippingSubsidyCents?: number;
  taxAbsorbedCents?: number;
  refundReserveCents?: number;
  fraudReserveCents?: number;
  supportReserveCents?: number;
};

export type BasketProfitDecision = {
  allowed: boolean;
  revenueCents: number;
  affiliateCommissionCents: number;
  landedCostCents: number;
  componentReserveCents: number;
  transactionCostCents: number;
  contributionProfitCents: number;
  reasons: string[];
};

export type MonetizationInput = {
  commercialRight: CommercialRight;
  hasDirectOffer: boolean;
  hasAffiliateOffer: boolean;
  directOfferPassesProfitGate: boolean;
  bundleCandidate: boolean;
  bundleRelevanceScore?: number | null;
  basketProfitPasses?: boolean;
};

function nonNegativeInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field.toUpperCase()}_INVALID`);
  return value;
}

function positiveInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field.toUpperCase()}_INVALID`);
  return value;
}

function boundedBps(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) throw new Error(`${field.toUpperCase()}_INVALID`);
  return value;
}

export function canDirectResell(right: CommercialRight) {
  return right.resaleAllowed === true && isDirectResaleSourceClass(right.sourceClass);
}

export function canAffiliate(right: CommercialRight) {
  return right.affiliateAllowed === true && Boolean(right.affiliateProvider);
}

export function bundleRelevanceScore(input: BundleRelevanceInput) {
  const compatibility = boundedBps(input.compatibilityBps, "compatibility_bps");
  const relationship = boundedBps(input.purchaseRelationshipBps, "purchase_relationship_bps");
  const usefulness = boundedBps(input.usefulnessBps, "usefulness_bps");
  const price = boundedBps(input.priceAdvantageBps, "price_advantage_bps");
  const margin = boundedBps(input.marginContributionBps, "margin_contribution_bps");
  const supplier = boundedBps(input.supplierConfidenceBps, "supplier_confidence_bps");

  return Math.round((
    compatibility * 30 +
    relationship * 25 +
    usefulness * 20 +
    price * 10 +
    margin * 10 +
    supplier * 5
  ) / 1_000_000 * 100);
}

export function evaluateBasketProfit(input: BasketProfitInput): BasketProfitDecision {
  if (!Array.isArray(input.components) || input.components.length < 1 || input.components.length > MAX_BUNDLE_COMPONENTS) {
    throw new Error("BASKET_COMPONENT_COUNT_INVALID");
  }

  const minimumProfitCents = nonNegativeInteger(input.minimumProfitCents, "minimum_profit_cents");
  const paymentCostCents = nonNegativeInteger(input.paymentCostCents ?? 0, "payment_cost_cents");
  const shippingSubsidyCents = nonNegativeInteger(input.shippingSubsidyCents ?? 0, "shipping_subsidy_cents");
  const taxAbsorbedCents = nonNegativeInteger(input.taxAbsorbedCents ?? 0, "tax_absorbed_cents");
  const refundReserveCents = nonNegativeInteger(input.refundReserveCents ?? 0, "refund_reserve_cents");
  const fraudReserveCents = nonNegativeInteger(input.fraudReserveCents ?? 0, "fraud_reserve_cents");
  const supportReserveCents = nonNegativeInteger(input.supportReserveCents ?? 0, "support_reserve_cents");

  let revenueCents = 0;
  let affiliateCommissionCents = 0;
  let landedCostCents = 0;
  let componentReserveCents = 0;
  const reasons: string[] = [];

  for (const component of input.components) {
    const quantity = positiveInteger(component.quantity, "quantity");
    const sellingPrice = nonNegativeInteger(component.sellingPriceCents, "selling_price_cents");
    const landedCost = nonNegativeInteger(component.landedCostCents, "landed_cost_cents");
    const reserve = nonNegativeInteger(component.reserveCents, "reserve_cents");
    const commission = nonNegativeInteger(component.affiliateCommissionCents ?? 0, "affiliate_commission_cents");

    if (component.directFulfillment) {
      if (!canDirectResell(component.commercialRight)) reasons.push(`component_${component.id}_resale_not_authorized`);
      if (sellingPrice < landedCost) reasons.push(`component_${component.id}_below_landed_cost`);
      revenueCents += sellingPrice * quantity;
      landedCostCents += landedCost * quantity;
      componentReserveCents += reserve * quantity;
    } else {
      if (!canAffiliate(component.commercialRight)) reasons.push(`component_${component.id}_affiliate_not_authorized`);
      affiliateCommissionCents += commission * quantity;
    }
  }

  const transactionCostCents = paymentCostCents + shippingSubsidyCents + taxAbsorbedCents + refundReserveCents + fraudReserveCents + supportReserveCents;
  const contributionProfitCents = revenueCents + affiliateCommissionCents - landedCostCents - componentReserveCents - transactionCostCents;

  if (contributionProfitCents < minimumProfitCents) reasons.push("basket_profit_floor_not_met");

  return {
    allowed: reasons.length === 0,
    revenueCents,
    affiliateCommissionCents,
    landedCostCents,
    componentReserveCents,
    transactionCostCents,
    contributionProfitCents,
    reasons,
  };
}

export function chooseMonetizationMode(input: MonetizationInput): MonetizationMode {
  const directAllowed = input.hasDirectOffer && canDirectResell(input.commercialRight);
  const affiliateAllowed = input.hasAffiliateOffer && canAffiliate(input.commercialRight);
  const bundleQualified = input.bundleCandidate &&
    (input.bundleRelevanceScore ?? 0) >= MIN_BUNDLE_RELEVANCE_SCORE &&
    input.basketProfitPasses === true;

  if (directAllowed && affiliateAllowed && bundleQualified) return "HYBRID";
  if (directAllowed && input.directOfferPassesProfitGate && bundleQualified) return "BUNDLE";
  if (directAllowed && input.directOfferPassesProfitGate) return "DIRECT";
  if (affiliateAllowed && bundleQualified) return "HYBRID";
  if (affiliateAllowed) return "AFFILIATE";
  return "BLOCKED";
}

export function validateAmazonCommerceBoundary(component: BasketComponent) {
  if (component.commercialRight.affiliateProvider !== "amazon") return true;
  if (component.directFulfillment) throw new Error("AMAZON_AFFILIATE_DIRECT_FULFILLMENT_FORBIDDEN");
  if (!canAffiliate(component.commercialRight)) throw new Error("AMAZON_AFFILIATE_AUTHORIZATION_REQUIRED");
  return true;
}

export function recommendBundleTier(index: number, total: number): BundleTier {
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(total) || total < 1 || index < 0 || index >= total) {
    throw new Error("BUNDLE_TIER_POSITION_INVALID");
  }
  if (total === 1) return "BEST_VALUE";
  if (index === 0) return "ESSENTIAL";
  if (index === total - 1) return "COMPLETE";
  return "BEST_VALUE";
}
