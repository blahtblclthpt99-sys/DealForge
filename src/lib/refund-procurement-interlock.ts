export const REFUND_ACTIVE_STATUSES = ["pending", "succeeded"] as const;
export const REFUND_PREPURCHASE_SAFE_STATUSES = [
  "awaiting_review",
  "approved_manual",
  "hold",
  "cancelled",
] as const;
export const REFUND_POSTPURCHASE_BLOCKED_STATUSES = [
  "supplier_ordered_manual",
  "shipped",
  "delivered",
] as const;

export const POST_PURCHASE_RECOVERY_PLANS = [
  "supplier_cancel_requested",
  "supplier_return_required",
  "customer_return_required",
  "customer_keep_accept_loss",
] as const;

export type PostPurchaseRecoveryPlan = (typeof POST_PURCHASE_RECOVERY_PLANS)[number];

export type PostPurchaseRefundException = {
  acknowledgeIrreversibleFulfillment: true;
  recoveryPlan: PostPurchaseRecoveryPlan;
  acceptUnrecoveredLoss?: boolean;
  note: string;
};

export type RefundInterlockIntent = {
  id: string;
  status: string;
};

export function hasActiveRefund(refunds: Array<{ status: string }>) {
  return refunds.some((refund) => (REFUND_ACTIVE_STATUSES as readonly string[]).includes(refund.status));
}

export function validatePostPurchaseRefundException(
  exception: PostPurchaseRefundException | undefined,
  blockingIntents: RefundInterlockIntent[],
) {
  if (blockingIntents.length === 0) return { ok: true as const };
  if (!exception || exception.acknowledgeIrreversibleFulfillment !== true) {
    return { ok: false as const, reason: "POST_PURCHASE_EXCEPTION_REQUIRED" as const };
  }
  if (!(POST_PURCHASE_RECOVERY_PLANS as readonly string[]).includes(exception.recoveryPlan)) {
    return { ok: false as const, reason: "POST_PURCHASE_RECOVERY_PLAN_INVALID" as const };
  }
  if (!exception.note || exception.note.trim().length < 8 || exception.note.trim().length > 500) {
    return { ok: false as const, reason: "POST_PURCHASE_EXCEPTION_NOTE_INVALID" as const };
  }
  if (exception.recoveryPlan === "customer_keep_accept_loss" && exception.acceptUnrecoveredLoss !== true) {
    return { ok: false as const, reason: "POST_PURCHASE_LOSS_ACK_REQUIRED" as const };
  }
  return { ok: true as const };
}

export function evaluateRefundProcurementInterlock(
  intents: RefundInterlockIntent[],
  postPurchaseException?: PostPurchaseRefundException,
) {
  const blocking = intents.filter((intent) =>
    (REFUND_POSTPURCHASE_BLOCKED_STATUSES as readonly string[]).includes(intent.status),
  );
  const unknown = intents.filter(
    (intent) =>
      !(REFUND_POSTPURCHASE_BLOCKED_STATUSES as readonly string[]).includes(intent.status) &&
      !(REFUND_PREPURCHASE_SAFE_STATUSES as readonly string[]).includes(intent.status) &&
      intent.status !== "blocked_source_integrity",
  );
  if (unknown.length > 0) {
    return {
      ok: false as const,
      reason: "REFUND_PROCUREMENT_STATE_UNSAFE" as const,
      intentIds: unknown.map((intent) => intent.id),
    };
  }
  if (blocking.length > 0) {
    const exception = validatePostPurchaseRefundException(postPurchaseException, blocking);
    if (!exception.ok) {
      return {
        ok: false as const,
        reason: exception.reason,
        intentIds: blocking.map((intent) => intent.id),
      };
    }
  }
  return {
    ok: true as const,
    holdIntentIds: intents
      .filter((intent) => ["awaiting_review", "approved_manual"].includes(intent.status))
      .map((intent) => intent.id),
    exceptionIntentIds: blocking.map((intent) => intent.id),
  };
}

export function refundInterlockEventKey(intentId: string, refundKey: string) {
  return `refund-interlock:${intentId}:${refundKey}`;
}

export function postPurchaseRefundExceptionEventKey(intentId: string, refundKey: string) {
  return `refund-post-purchase-exception:${intentId}:${refundKey}`;
}
