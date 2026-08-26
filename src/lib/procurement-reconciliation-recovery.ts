import { createHash } from "node:crypto";
import {
  PURCHASE_RECONCILIATION_BLOCKED_REASON,
  reconcileManualPurchaseProjection,
  type PurchaseReconciliationReason,
} from "./procurement-purchase-reconciliation";

export const PURCHASE_RECONCILIATION_RESOLUTION_EVENT = "PURCHASE_RECONCILIATION_RESOLVED" as const;
export const PURCHASE_RECONCILIATION_RECOVERY_VERSION = 1 as const;
export const PURCHASE_RECONCILIATION_RESOLUTION_TOKEN_PREFIX =
  "proc_purchase_reconciliation_resolution_v1_" as const;

type PurchaseProjection = Parameters<typeof reconcileManualPurchaseProjection>[0];

type ReconciliationAuditEvent = {
  type: string;
  detail: string;
  createdAt: Date;
};

export type PurchaseReconciliationRecoveryInput = Omit<PurchaseProjection, "events"> & {
  id: string;
  blockedReason: string | null;
  updatedAt: Date;
  purchaseEvents: PurchaseProjection["events"];
  auditEvents?: ReconciliationAuditEvent[];
};

export type PurchaseReconciliationRecoveryProjection = {
  version: typeof PURCHASE_RECONCILIATION_RECOVERY_VERSION;
  blockerActive: boolean;
  blockedReason: string | null;
  canResolve: boolean;
  resolutionToken: string | null;
  reconciliation: {
    ok: boolean;
    reasons: PurchaseReconciliationReason[];
  };
  immutableExecutionEvidence: {
    purchaseEvidenceHash: string;
    supplierOrderKey: string;
    sourceLockKey: string;
    persistedSupplierId: string;
    persistedOfferId: string;
    supplierOrderReference: string;
    quantity: number;
    currency: string;
    actualTotalCostCents: number;
    expectedTotalCostCents: number | null;
    lineRevenueCents: number;
  } | null;
  currentProjection: {
    status: string;
    supplierOrderReference: string | null;
    actualTotalCostCents: number | null;
    executedAt: string | null;
    quantity: number;
    currency: string;
    expectedTotalCostCents: number | null;
    lineRevenueCents: number;
  };
  latestFailure: {
    reasons: string[];
    recordedAt: string;
  } | null;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function parseObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readFailureReasons(events: ReconciliationAuditEvent[] | undefined) {
  if (!events?.length) return null;
  const latest = [...events]
    .filter((event) => event.type === "PURCHASE_RECONCILIATION_FAILED")
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
  if (!latest) return null;
  const detail = parseObject(latest.detail);
  const rawReasons = Array.isArray(detail?.reasons) ? detail.reasons : [];
  const reasons = rawReasons
    .filter((reason): reason is string => typeof reason === "string")
    .map((reason) => reason.trim())
    .filter(Boolean)
    .slice(0, 20);
  return {
    reasons,
    recordedAt: latest.createdAt.toISOString(),
  };
}

export function purchaseReconciliationResolutionToken(
  input: PurchaseReconciliationRecoveryInput,
  evidence: NonNullable<PurchaseReconciliationRecoveryProjection["immutableExecutionEvidence"]>,
) {
  const canonical = JSON.stringify({
    version: PURCHASE_RECONCILIATION_RECOVERY_VERSION,
    procurementIntentId: input.id,
    blockedReason: input.blockedReason,
    updatedAt: input.updatedAt.toISOString(),
    purchaseEvidenceHash: evidence.purchaseEvidenceHash,
    supplierOrderKey: evidence.supplierOrderKey,
    sourceLockKey: evidence.sourceLockKey,
    persistedSupplierId: evidence.persistedSupplierId,
    persistedOfferId: evidence.persistedOfferId,
    supplierOrderReference: evidence.supplierOrderReference,
    quantity: evidence.quantity,
    currency: evidence.currency,
    actualTotalCostCents: evidence.actualTotalCostCents,
    expectedTotalCostCents: evidence.expectedTotalCostCents,
    lineRevenueCents: evidence.lineRevenueCents,
  });
  return `${PURCHASE_RECONCILIATION_RESOLUTION_TOKEN_PREFIX}${sha256(canonical)}`;
}

export function purchaseReconciliationResolutionEventKey(intentId: string, resolutionToken: string) {
  return `procurement-purchase-reconciliation-resolved:${intentId}:${sha256(resolutionToken)}`;
}

export function projectPurchaseReconciliationRecovery(
  input: PurchaseReconciliationRecoveryInput,
): PurchaseReconciliationRecoveryProjection {
  const result = reconcileManualPurchaseProjection({
    status: input.status,
    supplierSnapshot: input.supplierSnapshot,
    quantity: input.quantity,
    expectedUnitCostCents: input.expectedUnitCostCents,
    expectedTotalCostCents: input.expectedTotalCostCents,
    currency: input.currency,
    supplierOrderReference: input.supplierOrderReference,
    actualTotalCostCents: input.actualTotalCostCents,
    executedAt: input.executedAt,
    orderItem: input.orderItem,
    events: input.purchaseEvents,
  });

  const immutableExecutionEvidence = result.evidence
    ? {
        purchaseEvidenceHash: result.evidence.purchaseEvidenceHash,
        supplierOrderKey: result.evidence.supplierOrderKey,
        sourceLockKey: result.evidence.sourceLockKey,
        persistedSupplierId: result.evidence.persistedSupplierId,
        persistedOfferId: result.evidence.persistedOfferId,
        supplierOrderReference: result.evidence.supplierOrderReference,
        quantity: result.evidence.quantity,
        currency: result.evidence.currency,
        actualTotalCostCents: result.evidence.actualTotalCostCents,
        expectedTotalCostCents: result.evidence.expectedTotalCostCents,
        lineRevenueCents: result.evidence.lineRevenueCents,
      }
    : null;
  const blockerActive = input.blockedReason === PURCHASE_RECONCILIATION_BLOCKED_REASON;
  const canResolve = Boolean(blockerActive && result.ok && immutableExecutionEvidence);
  const resolutionToken =
    canResolve && immutableExecutionEvidence
      ? purchaseReconciliationResolutionToken(input, immutableExecutionEvidence)
      : null;

  return {
    version: PURCHASE_RECONCILIATION_RECOVERY_VERSION,
    blockerActive,
    blockedReason: input.blockedReason,
    canResolve,
    resolutionToken,
    reconciliation: {
      ok: result.ok,
      reasons: result.reasons,
    },
    immutableExecutionEvidence,
    currentProjection: {
      status: input.status,
      supplierOrderReference: input.supplierOrderReference,
      actualTotalCostCents: input.actualTotalCostCents,
      executedAt: input.executedAt?.toISOString() || null,
      quantity: input.quantity,
      currency: input.currency,
      expectedTotalCostCents: input.expectedTotalCostCents,
      lineRevenueCents: input.orderItem.lineTotalCents,
    },
    latestFailure: readFailureReasons(input.auditEvents),
  };
}
