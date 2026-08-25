export const PROCUREMENT_STATUSES = [
  "awaiting_review",
  "approved_manual",
  "hold",
  "supplier_ordered_manual",
  "cancelled",
] as const;

export type ProcurementStatus = (typeof PROCUREMENT_STATUSES)[number];

export const PROCUREMENT_ACTIONS = [
  "APPROVE_MANUAL",
  "PLACE_HOLD",
  "RESUME_REVIEW",
  "RECORD_MANUAL_PURCHASE",
  "CANCEL",
] as const;

export type ProcurementAction = (typeof PROCUREMENT_ACTIONS)[number];

const allowedFrom: Record<ProcurementAction, readonly ProcurementStatus[]> = {
  APPROVE_MANUAL: ["awaiting_review"],
  PLACE_HOLD: ["awaiting_review", "approved_manual"],
  RESUME_REVIEW: ["hold"],
  RECORD_MANUAL_PURCHASE: ["approved_manual"],
  CANCEL: ["awaiting_review", "approved_manual", "hold"],
};

const nextStatus: Record<ProcurementAction, ProcurementStatus> = {
  APPROVE_MANUAL: "approved_manual",
  PLACE_HOLD: "hold",
  RESUME_REVIEW: "awaiting_review",
  RECORD_MANUAL_PURCHASE: "supplier_ordered_manual",
  CANCEL: "cancelled",
};

export function isProcurementStatus(value: unknown): value is ProcurementStatus {
  return typeof value === "string" && (PROCUREMENT_STATUSES as readonly string[]).includes(value);
}

export function transitionProcurement(
  current: ProcurementStatus,
  action: ProcurementAction,
): { ok: true; next: ProcurementStatus } | { ok: false; reason: "INVALID_TRANSITION" } {
  if (!allowedFrom[action].includes(current)) return { ok: false, reason: "INVALID_TRANSITION" };
  return { ok: true, next: nextStatus[action] };
}

export function procurementEventKey(intentId: string, action: ProcurementAction, nonce: string) {
  return `procurement-action:${intentId}:${action}:${nonce}`;
}

export function validateManualPurchaseEconomics(input: {
  actualTotalCostCents: number;
  expectedTotalCostCents: number | null;
  lineRevenueCents: number;
  acceptCostVariance: boolean;
  acceptLossRisk: boolean;
}) {
  if (!Number.isSafeInteger(input.actualTotalCostCents) || input.actualTotalCostCents <= 0) {
    return { ok: false as const, reason: "ACTUAL_COST_INVALID" as const };
  }
  if (!Number.isSafeInteger(input.lineRevenueCents) || input.lineRevenueCents <= 0) {
    return { ok: false as const, reason: "LINE_REVENUE_INVALID" as const };
  }

  const varianceCents =
    input.expectedTotalCostCents === null ? null : input.actualTotalCostCents - input.expectedTotalCostCents;

  if (varianceCents !== null && varianceCents > 0 && !input.acceptCostVariance) {
    return {
      ok: false as const,
      reason: "COST_VARIANCE_REQUIRES_ACKNOWLEDGEMENT" as const,
      varianceCents,
    };
  }
  if (input.actualTotalCostCents >= input.lineRevenueCents && !input.acceptLossRisk) {
    return {
      ok: false as const,
      reason: "LOSS_RISK_REQUIRES_ACKNOWLEDGEMENT" as const,
      varianceCents,
    };
  }

  return {
    ok: true as const,
    varianceCents,
    projectedGrossMarginCents: input.lineRevenueCents - input.actualTotalCostCents,
  };
}
