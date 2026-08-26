import { isBroadCatalogCommerceEnabled } from "./commerce-switch";
import { isDirectResaleSourceClass } from "./source-policy";

const RESERVE_KEYS = [
  "paymentCents",
  "returnsCents",
  "chargebackCents",
  "fraudCents",
  "supportCents",
  "fulfillmentCents",
  "acquisitionCents",
] as const;

type ReserveKey = (typeof RESERVE_KEYS)[number];

type CommercePolicyV1 = {
  sourceClass: string;
  resaleAllowed: boolean;
  sourceVerifiedAt: string;
  supplierPriceVerifiedAt: string | null;
  maxSourceAgeDays: number;
  maxPriceAgeMinutes: number;
  inventoryConfidenceBps: number;
  minInventoryConfidenceBps: number;
  minContributionProfitCents: number;
  minContributionMarginBps: number;
  reserves: Record<ReserveKey, number>;
};

export type CommerceGateInput = {
  commerceEnabled: boolean;
  availability: string;
  sellingPriceCents: number | null;
  landedCostCents: number | null;
  /**
   * Product-level provenance mirror. Supplier-cost freshness is authoritative
   * only from supplierOfferV1.priceVerifiedAt; when this mirror is present it
   * must match exactly or the gate fails closed on provenance drift.
   */
  priceVerifiedAt?: Date | null;
  specifications: string;
};

export type CommerceGateDecision = {
  allowed: boolean;
  reasons: string[];
  contributionProfitCents: number | null;
  contributionMarginBps: number | null;
  reserveTotalCents: number | null;
  sourceClass: string | null;
};

type CommerceGateOptions = {
  bypassBroadCatalogLock?: boolean;
};

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isBasisPoints(value: unknown): value is number {
  return isSafeNonNegativeInteger(value) && value <= 10_000;
}

function parseTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function supplierPriceVerifiedAt(root: Record<string, unknown>) {
  const offer = root.supplierOfferV1;
  if (!offer || typeof offer !== "object" || Array.isArray(offer)) return null;
  const raw = (offer as Record<string, unknown>).priceVerifiedAt;
  return typeof raw === "string" && parseTimestamp(raw) !== null ? raw : null;
}

function parsePolicy(specifications: string): CommercePolicyV1 | null {
  try {
    const root = JSON.parse(specifications) as Record<string, unknown>;
    const raw = root?.commerceV1;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const policy = raw as Record<string, unknown>;
    const reservesRaw = policy.reserves;
    if (!reservesRaw || typeof reservesRaw !== "object" || Array.isArray(reservesRaw)) return null;
    const reservesObject = reservesRaw as Record<string, unknown>;

    const sourceClass = typeof policy.sourceClass === "string" ? policy.sourceClass.trim() : "";
    const sourceVerifiedAt = typeof policy.sourceVerifiedAt === "string" ? policy.sourceVerifiedAt : "";
    const persistedPriceVerifiedAt = supplierPriceVerifiedAt(root);
    if (!sourceClass || parseTimestamp(sourceVerifiedAt) === null) return null;

    const maxSourceAgeDays = isSafePositiveInteger(policy.maxSourceAgeDays) ? policy.maxSourceAgeDays : null;
    const maxPriceAgeMinutes = isSafePositiveInteger(policy.maxPriceAgeMinutes) ? policy.maxPriceAgeMinutes : null;
    const inventoryConfidenceBps = isBasisPoints(policy.inventoryConfidenceBps) ? policy.inventoryConfidenceBps : null;
    const minInventoryConfidenceBps = isBasisPoints(policy.minInventoryConfidenceBps) ? policy.minInventoryConfidenceBps : null;
    const minContributionProfitCents = isSafePositiveInteger(policy.minContributionProfitCents)
      ? policy.minContributionProfitCents
      : null;
    const minContributionMarginBps = isBasisPoints(policy.minContributionMarginBps)
      ? policy.minContributionMarginBps
      : null;

    if (policy.resaleAllowed !== true) {
      return {
        sourceClass,
        resaleAllowed: false,
        sourceVerifiedAt,
        supplierPriceVerifiedAt: persistedPriceVerifiedAt,
        maxSourceAgeDays: maxSourceAgeDays ?? 0,
        maxPriceAgeMinutes: maxPriceAgeMinutes ?? 0,
        inventoryConfidenceBps: inventoryConfidenceBps ?? 0,
        minInventoryConfidenceBps: minInventoryConfidenceBps ?? 10_000,
        minContributionProfitCents: minContributionProfitCents ?? Number.MAX_SAFE_INTEGER,
        minContributionMarginBps: minContributionMarginBps ?? 10_000,
        reserves: Object.fromEntries(
          RESERVE_KEYS.map((key) => {
            const value = reservesObject[key];
            return [key, isSafeNonNegativeInteger(value) ? value : Number.MAX_SAFE_INTEGER];
          }),
        ) as Record<ReserveKey, number>,
      };
    }

    if (maxSourceAgeDays === null || maxSourceAgeDays > 365) return null;
    if (maxPriceAgeMinutes === null || maxPriceAgeMinutes > 10_080) return null;
    if (inventoryConfidenceBps === null) return null;
    if (minInventoryConfidenceBps === null) return null;
    if (minContributionProfitCents === null) return null;
    if (minContributionMarginBps === null) return null;

    const reserves = {} as Record<ReserveKey, number>;
    for (const key of RESERVE_KEYS) {
      const value = reservesObject[key];
      if (!isSafeNonNegativeInteger(value)) return null;
      reserves[key] = value;
    }

    return {
      sourceClass,
      resaleAllowed: true,
      sourceVerifiedAt,
      supplierPriceVerifiedAt: persistedPriceVerifiedAt,
      maxSourceAgeDays,
      maxPriceAgeMinutes,
      inventoryConfidenceBps,
      minInventoryConfidenceBps,
      minContributionProfitCents,
      minContributionMarginBps,
      reserves,
    };
  } catch {
    return null;
  }
}

export function evaluateCommerceGate(
  input: CommerceGateInput,
  nowMs = Date.now(),
  options: CommerceGateOptions = {},
): CommerceGateDecision {
  const reasons: string[] = [];
  const policy = parsePolicy(input.specifications);

  if (
    process.env.NODE_ENV === "production" &&
    !options.bypassBroadCatalogLock &&
    !isBroadCatalogCommerceEnabled()
  ) {
    reasons.push("broad_catalog_commerce_locked");
  }
  if (!input.commerceEnabled) reasons.push("commerce_disabled");
  if (input.availability !== "in_stock") reasons.push("inventory_not_in_stock");
  if (!isSafePositiveInteger(input.sellingPriceCents)) reasons.push("selling_price_invalid");
  if (!isSafePositiveInteger(input.landedCostCents)) reasons.push("landed_cost_invalid");
  if (!policy) {
    reasons.push("commercial_policy_missing_or_invalid");
    return {
      allowed: false,
      reasons,
      contributionProfitCents: null,
      contributionMarginBps: null,
      reserveTotalCents: null,
      sourceClass: null,
    };
  }

  if (!isDirectResaleSourceClass(policy.sourceClass)) reasons.push("source_class_not_direct_resale");
  if (!policy.resaleAllowed) reasons.push("resale_not_verified");

  const sourceVerifiedAt = parseTimestamp(policy.sourceVerifiedAt);
  if (sourceVerifiedAt === null || sourceVerifiedAt > nowMs + 5 * 60_000) {
    reasons.push("source_verification_invalid");
  } else if (nowMs - sourceVerifiedAt > policy.maxSourceAgeDays * 86_400_000) {
    reasons.push("source_verification_stale");
  }

  // The persisted supplier-offer timestamp is the sole authority for supplier
  // cost freshness. Product.priceVerifiedAt is only a provenance mirror and
  // may never make stale/missing supplier evidence appear fresh.
  const persistedPriceVerifiedAt = parseTimestamp(policy.supplierPriceVerifiedAt);
  if (
    persistedPriceVerifiedAt === null ||
    !Number.isFinite(persistedPriceVerifiedAt) ||
    persistedPriceVerifiedAt > nowMs + 5 * 60_000
  ) {
    reasons.push("supplier_cost_verification_invalid");
  } else if (nowMs - persistedPriceVerifiedAt > policy.maxPriceAgeMinutes * 60_000) {
    reasons.push("supplier_cost_verification_stale");
  }

  if (input.priceVerifiedAt) {
    const productPriceVerifiedAt = input.priceVerifiedAt.getTime();
    if (
      !Number.isFinite(productPriceVerifiedAt) ||
      persistedPriceVerifiedAt === null ||
      productPriceVerifiedAt !== persistedPriceVerifiedAt
    ) {
      reasons.push("product_price_verification_drift");
    }
  }

  if (policy.inventoryConfidenceBps < policy.minInventoryConfidenceBps) {
    reasons.push("inventory_confidence_below_floor");
  }

  const reserveValues = RESERVE_KEYS.map((key) => policy.reserves[key]);
  const reserveTotalCents = reserveValues.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(reserveTotalCents)) reasons.push("reserve_total_invalid");

  let contributionProfitCents: number | null = null;
  let contributionMarginBps: number | null = null;
  if (
    isSafePositiveInteger(input.sellingPriceCents) &&
    isSafePositiveInteger(input.landedCostCents) &&
    Number.isSafeInteger(reserveTotalCents)
  ) {
    contributionProfitCents = input.sellingPriceCents - input.landedCostCents - reserveTotalCents;
    contributionMarginBps = Math.floor((contributionProfitCents * 10_000) / input.sellingPriceCents);
    if (contributionProfitCents < policy.minContributionProfitCents) reasons.push("contribution_profit_below_floor");
    if (contributionMarginBps < policy.minContributionMarginBps) reasons.push("contribution_margin_below_floor");
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    contributionProfitCents,
    contributionMarginBps,
    reserveTotalCents: Number.isSafeInteger(reserveTotalCents) ? reserveTotalCents : null,
    sourceClass: policy.sourceClass,
  };
}

/** Certification still has to pass every commercial rule; only the broad-catalog
 * production kill switch is bypassed, and callers must independently require an
 * allowlisted internal certification product plus a Stripe test key. */
export function evaluateCertificationCommerceGate(input: CommerceGateInput, nowMs = Date.now()) {
  return evaluateCommerceGate(input, nowMs, { bypassBroadCatalogLock: true });
}
