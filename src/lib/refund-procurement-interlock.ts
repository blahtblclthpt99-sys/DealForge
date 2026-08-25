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

export type RefundInterlockIntent = {
  id: string;
  status: string;
};

export function hasActiveRefund(refunds: Array<{ status: string }>) {
  return refunds.some((refund) => (REFUND_ACTIVE_STATUSES as readonly string[]).includes(refund.status));
}

export function evaluateRefundProcurementInterlock(intents: RefundInterlockIntent[]) {
  const blocking = intents.filter((intent) =>
    (REFUND_POSTPURCHASE_BLOCKED_STATUSES as readonly string[]).includes(intent.status),
  );
  const unknown = intents.filter(
    (intent) =>
      !(REFUND_POSTPURCHASE_BLOCKED_STATUSES as readonly string[]).includes(intent.status) &&
      !(REFUND_PREPURCHASE_SAFE_STATUSES as readonly string[]).includes(intent.status) &&
      intent.status !== "blocked_source_integrity",
  );
  if (blocking.length > 0) {
    return {
      ok: false as const,
      reason: "REFUND_BLOCKED_AFTER_SUPPLIER_PURCHASE" as const,
      intentIds: blocking.map((intent) => intent.id),
    };
  }
  if (unknown.length > 0) {
    return {
      ok: false as const,
      reason: "REFUND_PROCUREMENT_STATE_UNSAFE" as const,
      intentIds: unknown.map((intent) => intent.id),
    };
  }
  return {
    ok: true as const,
    holdIntentIds: intents
      .filter((intent) => ["awaiting_review", "approved_manual"].includes(intent.status))
      .map((intent) => intent.id),
  };
}

export function refundInterlockEventKey(intentId: string, refundKey: string) {
  return `refund-interlock:${intentId}:${refundKey}`;
}
