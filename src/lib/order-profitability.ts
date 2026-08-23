export type OrderProfitabilityStatus =
  | "INVALID_INPUT"
  | "FINANCIAL_UNVERIFIED"
  | "UNSUPPORTED_CURRENCY"
  | "AWAITING_ACTUAL_SUPPLIER_COST"
  | "POSITIVE_CONTRIBUTION"
  | "BREAK_EVEN"
  | "NEGATIVE_CONTRIBUTION";

export type OrderProfitabilityInput = {
  currency: string;
  totalCents: number;
  refundedCents: number;
  paymentCertified: boolean;
  estimatedSupplierCostCents: number | null;
  actualSupplierCostCents: number | null;
};

export type OrderProfitability = {
  eligibleForRollup: boolean;
  status: OrderProfitabilityStatus;
  currency: string;
  grossCustomerRevenueCents: number;
  refundedCents: number;
  netCustomerRevenueCents: number;
  estimatedSupplierCostCents: number | null;
  actualSupplierCostCents: number | null;
  supplierCostVarianceCents: number | null;
  contributionCents: number | null;
  contributionMarginBps: number | null;
  excludesPaymentFeesAndOverhead: true;
};

function validNonNegativeCents(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validPositiveCents(value: number | null) {
  return value != null && Number.isSafeInteger(value) && value > 0;
}

function unavailableResult(
  status: Exclude<OrderProfitabilityStatus, "POSITIVE_CONTRIBUTION" | "BREAK_EVEN" | "NEGATIVE_CONTRIBUTION">,
  base: Omit<OrderProfitability, "eligibleForRollup" | "status" | "supplierCostVarianceCents" | "contributionCents" | "contributionMarginBps">,
): OrderProfitability {
  return {
    ...base,
    eligibleForRollup: false,
    status,
    supplierCostVarianceCents: null,
    contributionCents: null,
    contributionMarginBps: null,
  };
}

export function calculateOrderProfitability(input: OrderProfitabilityInput): OrderProfitability {
  const currency = input.currency.trim().toLowerCase();
  const moneyInputValid =
    validNonNegativeCents(input.totalCents) &&
    input.totalCents > 0 &&
    validNonNegativeCents(input.refundedCents) &&
    input.refundedCents <= input.totalCents &&
    (input.estimatedSupplierCostCents == null || validPositiveCents(input.estimatedSupplierCostCents)) &&
    (input.actualSupplierCostCents == null || validPositiveCents(input.actualSupplierCostCents));

  const totalCents = moneyInputValid ? input.totalCents : 0;
  const refundedCents = moneyInputValid ? input.refundedCents : 0;
  const netCustomerRevenueCents = totalCents - refundedCents;
  const estimatedSupplierCostCents = validPositiveCents(input.estimatedSupplierCostCents)
    ? input.estimatedSupplierCostCents
    : null;
  const actualSupplierCostCents = validPositiveCents(input.actualSupplierCostCents)
    ? input.actualSupplierCostCents
    : null;

  const base = {
    currency,
    grossCustomerRevenueCents: totalCents,
    refundedCents,
    netCustomerRevenueCents,
    estimatedSupplierCostCents,
    actualSupplierCostCents,
    excludesPaymentFeesAndOverhead: true as const,
  };

  if (!moneyInputValid) return unavailableResult("INVALID_INPUT", base);
  if (!input.paymentCertified) return unavailableResult("FINANCIAL_UNVERIFIED", base);
  if (currency !== "usd") return unavailableResult("UNSUPPORTED_CURRENCY", base);
  if (actualSupplierCostCents == null) return unavailableResult("AWAITING_ACTUAL_SUPPLIER_COST", base);

  const supplierCostVarianceCents = estimatedSupplierCostCents == null
    ? null
    : actualSupplierCostCents - estimatedSupplierCostCents;
  const contributionCents = netCustomerRevenueCents - actualSupplierCostCents;
  const contributionMarginBps = netCustomerRevenueCents > 0
    ? Math.trunc((contributionCents * 10_000) / netCustomerRevenueCents)
    : null;
  const status: OrderProfitabilityStatus = contributionCents > 0
    ? "POSITIVE_CONTRIBUTION"
    : contributionCents < 0
      ? "NEGATIVE_CONTRIBUTION"
      : "BREAK_EVEN";

  return {
    ...base,
    eligibleForRollup: true,
    status,
    supplierCostVarianceCents,
    contributionCents,
    contributionMarginBps,
  };
}

export type ProfitabilityRollup = {
  orderCount: number;
  realizedOrderCount: number;
  awaitingCostCount: number;
  excludedCount: number;
  negativeContributionCount: number;
  grossCustomerRevenueCents: number;
  refundedCents: number;
  netCustomerRevenueCents: number;
  actualSupplierCostCents: number;
  contributionCents: number;
  contributionMarginBps: number | null;
  excludesPaymentFeesAndOverhead: true;
};

export function rollupOrderProfitability(rows: OrderProfitability[]): ProfitabilityRollup {
  const realized = rows.filter(
    (row) => row.eligibleForRollup && row.actualSupplierCostCents != null && row.contributionCents != null,
  );
  const netCustomerRevenueCents = realized.reduce((sum, row) => sum + row.netCustomerRevenueCents, 0);
  const actualSupplierCostCents = realized.reduce((sum, row) => sum + (row.actualSupplierCostCents || 0), 0);
  const contributionCents = realized.reduce((sum, row) => sum + (row.contributionCents || 0), 0);

  return {
    orderCount: rows.length,
    realizedOrderCount: realized.length,
    awaitingCostCount: rows.filter((row) => row.status === "AWAITING_ACTUAL_SUPPLIER_COST").length,
    excludedCount: rows.length - realized.length,
    negativeContributionCount: realized.filter((row) => (row.contributionCents || 0) < 0).length,
    grossCustomerRevenueCents: realized.reduce((sum, row) => sum + row.grossCustomerRevenueCents, 0),
    refundedCents: realized.reduce((sum, row) => sum + row.refundedCents, 0),
    netCustomerRevenueCents,
    actualSupplierCostCents,
    contributionCents,
    contributionMarginBps: netCustomerRevenueCents > 0
      ? Math.trunc((contributionCents * 10_000) / netCustomerRevenueCents)
      : null,
    excludesPaymentFeesAndOverhead: true,
  };
}

function parseMeta(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function actualSupplierCostFromFulfillmentLogs(
  logs: Array<{ message: string; meta: unknown }>,
) {
  for (const log of logs) {
    if (log.message !== "MARK_SUPPLIER_ORDERED") continue;
    const meta = parseMeta(log.meta);
    const value = meta?.actualCostCents;
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  return null;
}
