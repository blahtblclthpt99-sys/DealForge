export const POST_PURCHASE_PROCUREMENT_STATUSES = [
  "supplier_ordered_manual",
  "shipped",
  "delivered",
] as const;

export const POST_PURCHASE_EXCEPTION_REASONS = [
  "customer_refund_request",
  "supplier_cancellation",
  "return_required",
  "damaged_or_wrong_item",
  "delivery_exception",
  "other",
] as const;

export const POST_PURCHASE_EVIDENCE_TYPES = [
  "supplier_cancellation_confirmed",
  "supplier_return_accepted",
  "supplier_credit_confirmed",
  "unrecoverable_loss_accepted",
] as const;

export type PostPurchaseProcurementStatus = (typeof POST_PURCHASE_PROCUREMENT_STATUSES)[number];
export type PostPurchaseExceptionReason = (typeof POST_PURCHASE_EXCEPTION_REASONS)[number];
export type PostPurchaseEvidenceType = (typeof POST_PURCHASE_EVIDENCE_TYPES)[number];

type JournalEvent = {
  type: string;
  detail: string;
  createdAt?: Date | string;
};

type RefundClearance = {
  refundIdempotencyKey: string;
  authorizedCustomerRefundCents: number;
  evidenceType: PostPurchaseEvidenceType;
  evidenceReference: string;
  supplierRecoveryCents: number;
  unrecoveredSupplierCostCents: number;
};

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function isPostPurchaseProcurementStatus(value: unknown): value is PostPurchaseProcurementStatus {
  return (
    typeof value === "string" &&
    (POST_PURCHASE_PROCUREMENT_STATUSES as readonly string[]).includes(value)
  );
}

export function validatePostPurchaseRecovery(input: {
  actualSupplierCostCents: number | null;
  supplierRecoveryCents: number;
  authorizedCustomerRefundCents: number;
  lineRevenueCents: number;
  acceptUnrecoveredSupplierCost: boolean;
}) {
  if (
    input.actualSupplierCostCents === null ||
    !Number.isSafeInteger(input.actualSupplierCostCents) ||
    input.actualSupplierCostCents <= 0
  ) {
    return { ok: false as const, reason: "ACTUAL_SUPPLIER_COST_REQUIRED" as const };
  }
  if (
    !Number.isSafeInteger(input.supplierRecoveryCents) ||
    input.supplierRecoveryCents < 0 ||
    input.supplierRecoveryCents > input.actualSupplierCostCents
  ) {
    return { ok: false as const, reason: "SUPPLIER_RECOVERY_INVALID" as const };
  }
  if (
    !Number.isSafeInteger(input.authorizedCustomerRefundCents) ||
    input.authorizedCustomerRefundCents <= 0 ||
    input.authorizedCustomerRefundCents > input.lineRevenueCents
  ) {
    return { ok: false as const, reason: "CUSTOMER_REFUND_AUTHORIZATION_INVALID" as const };
  }

  const unrecoveredSupplierCostCents = input.actualSupplierCostCents - input.supplierRecoveryCents;
  if (unrecoveredSupplierCostCents > 0 && !input.acceptUnrecoveredSupplierCost) {
    return {
      ok: false as const,
      reason: "UNRECOVERED_SUPPLIER_COST_REQUIRES_ACKNOWLEDGEMENT" as const,
      unrecoveredSupplierCostCents,
    };
  }

  return {
    ok: true as const,
    unrecoveredSupplierCostCents,
    projectedExceptionLossCents: Math.max(
      0,
      input.authorizedCustomerRefundCents + unrecoveredSupplierCostCents - input.lineRevenueCents,
    ),
  };
}

export function hasActivePostPurchaseException(events: JournalEvent[]) {
  let active = false;
  for (const event of events) {
    if (event.type === "OPEN_POST_PURCHASE_EXCEPTION") active = true;
    if (event.type === "CLOSE_POST_PURCHASE_EXCEPTION") active = false;
  }
  return active;
}

export function findPostPurchaseRefundClearance(
  events: JournalEvent[],
  refundIdempotencyKey: string,
): RefundClearance | null {
  let active = false;
  let clearance: RefundClearance | null = null;

  for (const event of events) {
    if (event.type === "OPEN_POST_PURCHASE_EXCEPTION") {
      active = true;
      clearance = null;
      continue;
    }
    if (event.type === "CLOSE_POST_PURCHASE_EXCEPTION") {
      active = false;
      clearance = null;
      continue;
    }
    if (!active || event.type !== "AUTHORIZE_POST_PURCHASE_REFUND") continue;

    const detail = parseObject(event.detail);
    if (!detail || detail.version !== 1) continue;
    if (detail.refundIdempotencyKey !== refundIdempotencyKey) continue;
    if (
      typeof detail.authorizedCustomerRefundCents !== "number" ||
      !Number.isSafeInteger(detail.authorizedCustomerRefundCents) ||
      detail.authorizedCustomerRefundCents <= 0 ||
      typeof detail.evidenceType !== "string" ||
      !(POST_PURCHASE_EVIDENCE_TYPES as readonly string[]).includes(detail.evidenceType) ||
      typeof detail.evidenceReference !== "string" ||
      detail.evidenceReference.length < 3 ||
      typeof detail.supplierRecoveryCents !== "number" ||
      !Number.isSafeInteger(detail.supplierRecoveryCents) ||
      detail.supplierRecoveryCents < 0 ||
      typeof detail.unrecoveredSupplierCostCents !== "number" ||
      !Number.isSafeInteger(detail.unrecoveredSupplierCostCents) ||
      detail.unrecoveredSupplierCostCents < 0 ||
      detail.manualEvidenceConfirmed !== true
    ) {
      continue;
    }

    clearance = {
      refundIdempotencyKey,
      authorizedCustomerRefundCents: detail.authorizedCustomerRefundCents,
      evidenceType: detail.evidenceType as PostPurchaseEvidenceType,
      evidenceReference: detail.evidenceReference,
      supplierRecoveryCents: detail.supplierRecoveryCents,
      unrecoveredSupplierCostCents: detail.unrecoveredSupplierCostCents,
    };
  }

  return active ? clearance : null;
}

export function postPurchaseExceptionEventKey(intentId: string, action: string, nonce: string) {
  return `post-purchase-exception:${intentId}:${action}:${nonce}`;
}

export function postPurchaseRefundExecutionEventKey(intentId: string, refundKey: string) {
  return `post-purchase-refund-executed:${intentId}:${refundKey}`;
}
