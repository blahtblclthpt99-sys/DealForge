export const PROCUREMENT_APPROVAL_LEASE_MINUTES = 15;
export const PROCUREMENT_APPROVAL_LEASE_MS = PROCUREMENT_APPROVAL_LEASE_MINUTES * 60_000;
export const PROCUREMENT_APPROVAL_FUTURE_TOLERANCE_MS = 5 * 60_000;

export type ProcurementApprovalLeaseReason =
  | "approval_timestamp_missing_or_invalid"
  | "approval_timestamp_in_future"
  | "approval_lease_expired";

export type ProcurementApprovalLeaseDecision = {
  valid: boolean;
  reason: ProcurementApprovalLeaseReason | null;
  approvedAt: string | null;
  expiresAt: string | null;
  remainingMs: number;
  leaseMinutes: typeof PROCUREMENT_APPROVAL_LEASE_MINUTES;
};

function timestampMs(value: Date | string | null | undefined) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function evaluateProcurementApprovalLease(
  approvedAt: Date | string | null | undefined,
  nowMs = Date.now(),
): ProcurementApprovalLeaseDecision {
  const approvedMs = timestampMs(approvedAt);
  if (approvedMs === null) {
    return {
      valid: false,
      reason: "approval_timestamp_missing_or_invalid",
      approvedAt: null,
      expiresAt: null,
      remainingMs: 0,
      leaseMinutes: PROCUREMENT_APPROVAL_LEASE_MINUTES,
    };
  }

  const approvedIso = new Date(approvedMs).toISOString();
  const expiresMs = approvedMs + PROCUREMENT_APPROVAL_LEASE_MS;
  const expiresAt = new Date(expiresMs).toISOString();

  if (approvedMs > nowMs + PROCUREMENT_APPROVAL_FUTURE_TOLERANCE_MS) {
    return {
      valid: false,
      reason: "approval_timestamp_in_future",
      approvedAt: approvedIso,
      expiresAt,
      remainingMs: 0,
      leaseMinutes: PROCUREMENT_APPROVAL_LEASE_MINUTES,
    };
  }

  const remainingMs = Math.max(0, expiresMs - nowMs);
  if (remainingMs <= 0) {
    return {
      valid: false,
      reason: "approval_lease_expired",
      approvedAt: approvedIso,
      expiresAt,
      remainingMs: 0,
      leaseMinutes: PROCUREMENT_APPROVAL_LEASE_MINUTES,
    };
  }

  return {
    valid: true,
    reason: null,
    approvedAt: approvedIso,
    expiresAt,
    remainingMs,
    leaseMinutes: PROCUREMENT_APPROVAL_LEASE_MINUTES,
  };
}
