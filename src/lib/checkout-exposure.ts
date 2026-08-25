export type CheckoutExposureReason =
  | "OK"
  | "INVALID_INPUT"
  | "LINE_QUANTITY_LIMIT_EXCEEDED"
  | "UNIT_COUNT_LIMIT_EXCEEDED"
  | "CUSTOMER_TOTAL_LIMIT_EXCEEDED"
  | "SUPPLIER_EXPOSURE_LIMIT_EXCEEDED";

export type CheckoutExposureLine = {
  quantity: number;
  unitPriceCents: number;
  landedCostCents: number | null;
};

export type CheckoutExposureLimits = {
  maxLineQuantity: number;
  maxUnitCount: number;
  maxCustomerTotalCents: number;
  maxSupplierExposureCents: number;
};

export type CheckoutExposureResult = {
  eligible: boolean;
  reason: CheckoutExposureReason;
  unitCount: number | null;
  customerTotalCents: number | null;
  supplierExposureCents: number | null;
};

// Pilot limits deliberately constrain how much DealForge can become obligated
// to source through a single Checkout Session. Raise only through reviewed code.
export const CHECKOUT_EXPOSURE_LIMITS: CheckoutExposureLimits = Object.freeze({
  maxLineQuantity: 5,
  maxUnitCount: 8,
  maxCustomerTotalCents: 150_000,
  maxSupplierExposureCents: 100_000,
});

function validPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function invalid(reason: CheckoutExposureReason = "INVALID_INPUT"): CheckoutExposureResult {
  return {
    eligible: false,
    reason,
    unitCount: null,
    customerTotalCents: null,
    supplierExposureCents: null,
  };
}

export function checkCheckoutExposure(
  lines: CheckoutExposureLine[],
  limits: CheckoutExposureLimits = CHECKOUT_EXPOSURE_LIMITS,
): CheckoutExposureResult {
  if (!Array.isArray(lines) || lines.length === 0) return invalid();
  if (
    !validPositiveSafeInteger(limits.maxLineQuantity) ||
    !validPositiveSafeInteger(limits.maxUnitCount) ||
    !validPositiveSafeInteger(limits.maxCustomerTotalCents) ||
    !validPositiveSafeInteger(limits.maxSupplierExposureCents)
  ) {
    return invalid();
  }

  let unitCount = BigInt(0);
  let customerTotalCents = BigInt(0);
  let supplierExposureCents = BigInt(0);
  const maxLineQuantity = BigInt(limits.maxLineQuantity);
  const maxUnitCount = BigInt(limits.maxUnitCount);
  const maxCustomerTotalCents = BigInt(limits.maxCustomerTotalCents);
  const maxSupplierExposureCents = BigInt(limits.maxSupplierExposureCents);

  for (const line of lines) {
    if (
      !validPositiveSafeInteger(line.quantity) ||
      !validPositiveSafeInteger(line.unitPriceCents) ||
      !validPositiveSafeInteger(line.landedCostCents)
    ) {
      return invalid();
    }

    const quantity = BigInt(line.quantity);
    if (quantity > maxLineQuantity) return invalid("LINE_QUANTITY_LIMIT_EXCEEDED");

    unitCount += quantity;
    if (unitCount > maxUnitCount) return invalid("UNIT_COUNT_LIMIT_EXCEEDED");

    customerTotalCents += BigInt(line.unitPriceCents) * quantity;
    if (customerTotalCents > maxCustomerTotalCents) {
      return invalid("CUSTOMER_TOTAL_LIMIT_EXCEEDED");
    }

    supplierExposureCents += BigInt(line.landedCostCents) * quantity;
    if (supplierExposureCents > maxSupplierExposureCents) {
      return invalid("SUPPLIER_EXPOSURE_LIMIT_EXCEEDED");
    }
  }

  if (
    unitCount > BigInt(Number.MAX_SAFE_INTEGER) ||
    customerTotalCents > BigInt(Number.MAX_SAFE_INTEGER) ||
    supplierExposureCents > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return invalid();
  }

  return {
    eligible: true,
    reason: "OK",
    unitCount: Number(unitCount),
    customerTotalCents: Number(customerTotalCents),
    supplierExposureCents: Number(supplierExposureCents),
  };
}
