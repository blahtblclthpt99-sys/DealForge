export const PROCUREMENT_STATUSES = [
  "blocked_source_integrity",
  "awaiting_review",
  "approved",
  "sourcing",
  "purchase_authorized",
  "supplier_ordered",
  "reconciled",
  "hold",
  "cancelled",
] as const;

export type ProcurementStatus = (typeof PROCUREMENT_STATUSES)[number];

export const PROCUREMENT_ACTIONS = [
  "APPROVE",
  "START_SOURCING",
  "AUTHORIZE_MANUAL_PURCHASE",
  "RECORD_MANUAL_SUPPLIER_ORDER",
  "RECONCILE_ACTUAL_COST",
  "PLACE_HOLD",
  "RESUME",
  "CANCEL_BEFORE_PURCHASE",
] as const;

export type ProcurementAction = (typeof PROCUREMENT_ACTIONS)[number];

export const PROCUREMENT_AUTHORIZATION_TTL_MS = 30 * 60 * 1000;
export const PROCUREMENT_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const PROCUREMENT_ORDER_EXPOSURE_CAP_CENTS = 100_000;

const directTransitions: Partial<Record<ProcurementAction, Partial<Record<ProcurementStatus, ProcurementStatus>>>> = {
  APPROVE: { awaiting_review: "approved" },
  START_SOURCING: { approved: "sourcing" },
  AUTHORIZE_MANUAL_PURCHASE: { sourcing: "purchase_authorized" },
  RECORD_MANUAL_SUPPLIER_ORDER: { purchase_authorized: "supplier_ordered" },
  RECONCILE_ACTUAL_COST: { supplier_ordered: "reconciled" },
  PLACE_HOLD: {
    awaiting_review: "hold",
    approved: "hold",
    sourcing: "hold",
    purchase_authorized: "hold",
  },
  CANCEL_BEFORE_PURCHASE: {
    awaiting_review: "cancelled",
    approved: "cancelled",
    sourcing: "cancelled",
    purchase_authorized: "cancelled",
    hold: "cancelled",
  },
};

export function isProcurementStatus(value: unknown): value is ProcurementStatus {
  return typeof value === "string" && (PROCUREMENT_STATUSES as readonly string[]).includes(value);
}

export function resumeStatusAfterHold(previousStatus: ProcurementStatus): ProcurementStatus | null {
  if (previousStatus === "purchase_authorized") return "sourcing";
  if (["awaiting_review", "approved", "sourcing"].includes(previousStatus)) return previousStatus;
  return null;
}

export function transitionProcurementStatus(
  currentStatus: ProcurementStatus,
  action: ProcurementAction,
  resumeStatus?: ProcurementStatus | null,
): { ok: true; nextStatus: ProcurementStatus } | { ok: false; reason: "INVALID_PROCUREMENT_TRANSITION" } {
  if (action === "RESUME") {
    if (currentStatus !== "hold" || !resumeStatus || resumeStatus === "hold") {
      return { ok: false, reason: "INVALID_PROCUREMENT_TRANSITION" };
    }
    return { ok: true, nextStatus: resumeStatus };
  }

  const nextStatus = directTransitions[action]?.[currentStatus];
  return nextStatus
    ? { ok: true, nextStatus }
    : { ok: false, reason: "INVALID_PROCUREMENT_TRANSITION" };
}

function positiveSafeInteger(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export type ProcurementCostControlReason =
  | "PROCUREMENT_COST_INPUT_INVALID"
  | "PROCUREMENT_COST_VARIANCE_REQUIRES_ACKNOWLEDGEMENT"
  | "PROCUREMENT_LOSS_RISK_REQUIRES_ACKNOWLEDGEMENT";

export function validateProcurementCostControls(input: {
  expectedTotalCostCents: number | null;
  lineRevenueCents: number;
  proposedTotalCostCents: number;
  acceptCostVariance?: boolean;
  acceptLossRisk?: boolean;
}): { ok: true; varianceCents: number } | { ok: false; reason: ProcurementCostControlReason } {
  if (
    !positiveSafeInteger(input.expectedTotalCostCents) ||
    !positiveSafeInteger(input.lineRevenueCents) ||
    !positiveSafeInteger(input.proposedTotalCostCents)
  ) {
    return { ok: false, reason: "PROCUREMENT_COST_INPUT_INVALID" };
  }

  const varianceCents = input.proposedTotalCostCents - input.expectedTotalCostCents;
  if (varianceCents > 0 && input.acceptCostVariance !== true) {
    return { ok: false, reason: "PROCUREMENT_COST_VARIANCE_REQUIRES_ACKNOWLEDGEMENT" };
  }
  if (input.proposedTotalCostCents >= input.lineRevenueCents && input.acceptLossRisk !== true) {
    return { ok: false, reason: "PROCUREMENT_LOSS_RISK_REQUIRES_ACKNOWLEDGEMENT" };
  }

  return { ok: true, varianceCents };
}

export type ProcurementAuthorizationReason =
  | ProcurementCostControlReason
  | "PROCUREMENT_QUOTE_TIMESTAMP_INVALID"
  | "PROCUREMENT_QUOTE_IN_FUTURE"
  | "PROCUREMENT_QUOTE_STALE";

export function validateManualPurchaseAuthorization(input: {
  expectedTotalCostCents: number | null;
  lineRevenueCents: number;
  quotedTotalCostCents: number;
  quoteVerifiedAt: string;
  nowMs?: number;
  acceptCostVariance?: boolean;
  acceptLossRisk?: boolean;
}):
  | { ok: true; varianceCents: number; authorizationExpiresAt: Date }
  | { ok: false; reason: ProcurementAuthorizationReason } {
  const verifiedAtMs = Date.parse(input.quoteVerifiedAt);
  if (!Number.isFinite(verifiedAtMs)) {
    return { ok: false, reason: "PROCUREMENT_QUOTE_TIMESTAMP_INVALID" };
  }

  const nowMs = input.nowMs ?? Date.now();
  if (verifiedAtMs > nowMs + PROCUREMENT_CLOCK_SKEW_MS) {
    return { ok: false, reason: "PROCUREMENT_QUOTE_IN_FUTURE" };
  }
  if (nowMs - verifiedAtMs > PROCUREMENT_AUTHORIZATION_TTL_MS) {
    return { ok: false, reason: "PROCUREMENT_QUOTE_STALE" };
  }

  const cost = validateProcurementCostControls({
    expectedTotalCostCents: input.expectedTotalCostCents,
    lineRevenueCents: input.lineRevenueCents,
    proposedTotalCostCents: input.quotedTotalCostCents,
    acceptCostVariance: input.acceptCostVariance,
    acceptLossRisk: input.acceptLossRisk,
  });
  if (!cost.ok) return cost;

  return {
    ok: true,
    varianceCents: cost.varianceCents,
    authorizationExpiresAt: new Date(verifiedAtMs + PROCUREMENT_AUTHORIZATION_TTL_MS),
  };
}

export type ProcurementManualPurchaseReason =
  | "PROCUREMENT_AUTHORIZATION_MISSING"
  | "PROCUREMENT_AUTHORIZATION_EXPIRED"
  | "PROCUREMENT_MANUAL_PURCHASE_COST_INVALID"
  | "PROCUREMENT_MANUAL_PURCHASE_EXCEEDS_AUTHORIZATION";

export function validateManualPurchaseRecord(input: {
  authorizedTotalCostCents: number | null;
  authorizationExpiresAt: Date | null;
  actualTotalCostCents: number;
  nowMs?: number;
}): { ok: true } | { ok: false; reason: ProcurementManualPurchaseReason } {
  if (!positiveSafeInteger(input.authorizedTotalCostCents) || !input.authorizationExpiresAt) {
    return { ok: false, reason: "PROCUREMENT_AUTHORIZATION_MISSING" };
  }
  const expiresAtMs = input.authorizationExpiresAt.getTime();
  if (!Number.isFinite(expiresAtMs) || (input.nowMs ?? Date.now()) > expiresAtMs) {
    return { ok: false, reason: "PROCUREMENT_AUTHORIZATION_EXPIRED" };
  }
  if (!positiveSafeInteger(input.actualTotalCostCents)) {
    return { ok: false, reason: "PROCUREMENT_MANUAL_PURCHASE_COST_INVALID" };
  }
  if (input.actualTotalCostCents > input.authorizedTotalCostCents) {
    return { ok: false, reason: "PROCUREMENT_MANUAL_PURCHASE_EXCEEDS_AUTHORIZATION" };
  }
  return { ok: true };
}

export function safeProcurementExposureTotal(values: Array<number | null | undefined>) {
  let total = 0;
  for (const value of values) {
    if (value == null) continue;
    if (!positiveSafeInteger(value)) return null;
    total += value;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}
