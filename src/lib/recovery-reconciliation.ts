import { createHash } from "node:crypto";
import {
  POST_PURCHASE_RECOVERY_PLANS,
  type PostPurchaseRecoveryPlan,
} from "@/lib/refund-procurement-interlock";

export const RECOVERY_EVENT_TYPES = [
  "CUSTOMER_RETURN_RECEIVED",
  "SUPPLIER_RETURN_SENT",
  "SUPPLIER_RECOVERY_RECORDED",
  "UNRECOVERED_LOSS_ACCEPTED",
  "RECOVERY_RECONCILED",
] as const;

export type RecoveryEventType = (typeof RECOVERY_EVENT_TYPES)[number];

export type RecoveryLedgerEvent = {
  type: string;
  detail: string;
  createdAt: Date | string;
};

export type RecoveryRefundView = {
  idempotencyKey: string;
  status: string;
  amountCents: number;
};

type Detail = Record<string, unknown>;

function safeDetail(value: string): Detail | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Detail)
      : null;
  } catch {
    return null;
  }
}

function isRecoveryPlan(value: unknown): value is PostPurchaseRecoveryPlan {
  return (
    typeof value === "string" &&
    (POST_PURCHASE_RECOVERY_PLANS as readonly string[]).includes(value)
  );
}

function detailRefundKey(detail: Detail | null) {
  return detail && typeof detail.refundIdempotencyKey === "string"
    ? detail.refundIdempotencyKey
    : null;
}

function safeMoney(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function safeQuantity(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

export function recoveryEventKey(
  intentId: string,
  refundIdempotencyKey: string,
  action: RecoveryEventType,
  operationKey = "single",
) {
  const digest = createHash("sha256")
    .update(`${refundIdempotencyKey}|${action}|${operationKey}`)
    .digest("hex")
    .slice(0, 40);
  return `recovery:${intentId}:${digest}`;
}

export function recoveryRequestHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function findPostPurchaseException(
  events: RecoveryLedgerEvent[],
  refundIdempotencyKey: string,
) {
  for (const event of events) {
    if (event.type !== "POST_PURCHASE_REFUND_EXCEPTION_APPROVED") continue;
    const detail = safeDetail(event.detail);
    if (detailRefundKey(detail) !== refundIdempotencyKey) continue;
    const recoveryPlan = detail?.recoveryPlan;
    const amountCents = safeMoney(detail?.amountCents);
    if (!isRecoveryPlan(recoveryPlan) || amountCents === null || amountCents <= 0) {
      return { ok: false as const, reason: "RECOVERY_EXCEPTION_EVENT_INVALID" as const };
    }
    return {
      ok: true as const,
      recoveryPlan,
      customerRefundAmountCents: amountCents,
      approvedAt: event.createdAt,
    };
  }
  return { ok: false as const, reason: "RECOVERY_EXCEPTION_NOT_FOUND" as const };
}

export function projectRecoveryReconciliation(input: {
  events: RecoveryLedgerEvent[];
  refund: RecoveryRefundView | null;
  refundIdempotencyKey: string;
  actualTotalCostCents: number | null;
  intentQuantity: number;
}) {
  const exception = findPostPurchaseException(
    input.events,
    input.refundIdempotencyKey,
  );

  if (!exception.ok) {
    return {
      ok: false as const,
      reason: exception.reason,
      refundIdempotencyKey: input.refundIdempotencyKey,
    };
  }

  const targetSupplierExposureCents =
    input.actualTotalCostCents !== null &&
    Number.isSafeInteger(input.actualTotalCostCents) &&
    input.actualTotalCostCents > 0
      ? input.actualTotalCostCents
      : null;
  const targetQuantity =
    Number.isSafeInteger(input.intentQuantity) && input.intentQuantity > 0
      ? input.intentQuantity
      : null;

  let supplierRecoveredCents = 0;
  let acceptedLossCents = 0;
  let customerReturnedQuantity = 0;
  let supplierReturnSentQuantity = 0;
  let closed = false;

  for (const event of input.events) {
    const detail = safeDetail(event.detail);
    if (detailRefundKey(detail) !== input.refundIdempotencyKey) continue;

    if (event.type === "CUSTOMER_RETURN_RECEIVED") {
      const quantity = safeQuantity(detail?.quantity);
      if (quantity !== null) customerReturnedQuantity += quantity;
    } else if (event.type === "SUPPLIER_RETURN_SENT") {
      const quantity = safeQuantity(detail?.quantity);
      if (quantity !== null) supplierReturnSentQuantity += quantity;
    } else if (event.type === "SUPPLIER_RECOVERY_RECORDED") {
      const amount = safeMoney(detail?.amountCents);
      if (amount !== null) supplierRecoveredCents += amount;
    } else if (event.type === "UNRECOVERED_LOSS_ACCEPTED") {
      const amount = safeMoney(detail?.amountCents);
      if (amount !== null) acceptedLossCents += amount;
    } else if (event.type === "RECOVERY_RECONCILED") {
      closed = true;
    }
  }

  const accountedSupplierExposureCents = supplierRecoveredCents + acceptedLossCents;
  const overAccounted =
    targetSupplierExposureCents !== null &&
    accountedSupplierExposureCents > targetSupplierExposureCents;
  const remainingSupplierExposureCents =
    targetSupplierExposureCents === null
      ? null
      : Math.max(0, targetSupplierExposureCents - accountedSupplierExposureCents);

  const requiredEvidenceSatisfied =
    exception.recoveryPlan === "customer_return_required"
      ? targetQuantity !== null && customerReturnedQuantity >= targetQuantity
      : exception.recoveryPlan === "supplier_return_required"
        ? targetQuantity !== null && supplierReturnSentQuantity >= targetQuantity
        : true;

  const refundSucceeded = input.refund?.status === "succeeded";
  const canClose =
    refundSucceeded &&
    targetSupplierExposureCents !== null &&
    remainingSupplierExposureCents === 0 &&
    !overAccounted &&
    requiredEvidenceSatisfied;

  return {
    ok: true as const,
    refundIdempotencyKey: input.refundIdempotencyKey,
    refundStatus: input.refund?.status || "missing",
    customerRefundAmountCents: exception.customerRefundAmountCents,
    recoveryPlan: exception.recoveryPlan,
    targetSupplierExposureCents,
    targetQuantity,
    supplierRecoveredCents,
    acceptedLossCents,
    accountedSupplierExposureCents,
    remainingSupplierExposureCents,
    customerReturnedQuantity,
    supplierReturnSentQuantity,
    requiredEvidenceSatisfied,
    overAccounted,
    canClose,
    closed,
  };
}

export function listRecoveryCases(input: {
  events: RecoveryLedgerEvent[];
  refunds: RecoveryRefundView[];
  actualTotalCostCents: number | null;
  intentQuantity: number;
}) {
  const keys = new Set<string>();
  for (const event of input.events) {
    if (event.type !== "POST_PURCHASE_REFUND_EXCEPTION_APPROVED") continue;
    const detail = safeDetail(event.detail);
    const key = detailRefundKey(detail);
    if (key) keys.add(key);
  }

  return Array.from(keys).map((refundIdempotencyKey) =>
    projectRecoveryReconciliation({
      events: input.events,
      refund:
        input.refunds.find(
          (refund) => refund.idempotencyKey === refundIdempotencyKey,
        ) || null,
      refundIdempotencyKey,
      actualTotalCostCents: input.actualTotalCostCents,
      intentQuantity: input.intentQuantity,
    }),
  );
}
