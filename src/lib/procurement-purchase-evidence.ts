import { createHash } from "node:crypto";
import type { ProcurementSourceLockV1 } from "./procurement-source-lock";

export const MANUAL_PURCHASE_EVIDENCE_VERSION = 1 as const;

export type ManualPurchaseExecutionEvidenceV1 = {
  version: typeof MANUAL_PURCHASE_EVIDENCE_VERSION;
  supplierOrderKey: string;
  purchaseEvidenceHash: string;
  sourceLockKey: string;
  persistedSupplierId: string;
  persistedOfferId: string;
  supplierOrderReference: string;
  quantity: number;
  currency: string;
  actualTotalCostCents: number;
  expectedTotalCostCents: number | null;
  lineRevenueCents: number;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safePositiveInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

function safeNullablePositiveInteger(value: number | null) {
  return value === null || safePositiveInteger(value);
}

export function deriveManualPurchaseExecutionEvidence(input: {
  sourceLock: ProcurementSourceLockV1 | null;
  supplierOrderReference: string;
  quantity: number;
  currency: string;
  actualTotalCostCents: number;
  expectedTotalCostCents: number | null;
  lineRevenueCents: number;
}): ManualPurchaseExecutionEvidenceV1 | null {
  const supplierOrderReference = input.supplierOrderReference.trim();
  const currency = input.currency.trim().toLowerCase();
  const sourceLock = input.sourceLock;
  if (
    !sourceLock ||
    !supplierOrderReference ||
    !safePositiveInteger(input.quantity) ||
    !safePositiveInteger(input.actualTotalCostCents) ||
    !safeNullablePositiveInteger(input.expectedTotalCostCents) ||
    !safePositiveInteger(input.lineRevenueCents) ||
    !/^[a-z]{3}$/.test(currency) ||
    sourceLock.currency !== currency
  ) {
    return null;
  }

  const supplierOrderCanonical = JSON.stringify({
    version: MANUAL_PURCHASE_EVIDENCE_VERSION,
    persistedSupplierId: sourceLock.persistedSupplierId,
    supplierOrderReference,
  });
  const supplierOrderKey = `proc_supplier_order_v1_${sha256(supplierOrderCanonical)}`;

  const evidenceCanonical = JSON.stringify({
    version: MANUAL_PURCHASE_EVIDENCE_VERSION,
    supplierOrderKey,
    sourceLockKey: sourceLock.sourceLockKey,
    persistedSupplierId: sourceLock.persistedSupplierId,
    persistedOfferId: sourceLock.persistedOfferId,
    supplierOrderReference,
    quantity: input.quantity,
    currency,
    actualTotalCostCents: input.actualTotalCostCents,
    expectedTotalCostCents: input.expectedTotalCostCents,
    lineRevenueCents: input.lineRevenueCents,
  });

  return {
    version: MANUAL_PURCHASE_EVIDENCE_VERSION,
    supplierOrderKey,
    purchaseEvidenceHash: `proc_purchase_evidence_v1_${sha256(evidenceCanonical)}`,
    sourceLockKey: sourceLock.sourceLockKey,
    persistedSupplierId: sourceLock.persistedSupplierId,
    persistedOfferId: sourceLock.persistedOfferId,
    supplierOrderReference,
    quantity: input.quantity,
    currency,
    actualTotalCostCents: input.actualTotalCostCents,
    expectedTotalCostCents: input.expectedTotalCostCents,
    lineRevenueCents: input.lineRevenueCents,
  };
}

export function manualPurchaseExecutionEventKey(evidence: ManualPurchaseExecutionEvidenceV1) {
  return `procurement-manual-purchase:${evidence.supplierOrderKey}`;
}

export function parseManualPurchaseExecutionEvidence(value: unknown): ManualPurchaseExecutionEvidenceV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<ManualPurchaseExecutionEvidenceV1>;
  if (
    candidate.version !== MANUAL_PURCHASE_EVIDENCE_VERSION ||
    typeof candidate.supplierOrderKey !== "string" ||
    !/^proc_supplier_order_v1_[a-f0-9]{64}$/.test(candidate.supplierOrderKey) ||
    typeof candidate.purchaseEvidenceHash !== "string" ||
    !/^proc_purchase_evidence_v1_[a-f0-9]{64}$/.test(candidate.purchaseEvidenceHash) ||
    typeof candidate.sourceLockKey !== "string" ||
    !/^proc_source_lock_v1_[a-f0-9]{64}$/.test(candidate.sourceLockKey) ||
    typeof candidate.persistedSupplierId !== "string" ||
    !candidate.persistedSupplierId ||
    typeof candidate.persistedOfferId !== "string" ||
    !candidate.persistedOfferId ||
    typeof candidate.supplierOrderReference !== "string" ||
    !candidate.supplierOrderReference ||
    !safePositiveInteger(candidate.quantity as number) ||
    typeof candidate.currency !== "string" ||
    !/^[a-z]{3}$/.test(candidate.currency) ||
    !safePositiveInteger(candidate.actualTotalCostCents as number) ||
    !safeNullablePositiveInteger(candidate.expectedTotalCostCents as number | null) ||
    !safePositiveInteger(candidate.lineRevenueCents as number)
  ) {
    return null;
  }
  return candidate as ManualPurchaseExecutionEvidenceV1;
}

export function readManualPurchaseExecutionEvidence(detail: string) {
  try {
    const parsed = JSON.parse(detail) as { executionEvidence?: unknown };
    return parseManualPurchaseExecutionEvidence(parsed.executionEvidence);
  } catch {
    return null;
  }
}

export function manualPurchaseEvidenceMatches(
  left: ManualPurchaseExecutionEvidenceV1 | null,
  right: ManualPurchaseExecutionEvidenceV1 | null,
) {
  return Boolean(left && right && left.purchaseEvidenceHash === right.purchaseEvidenceHash);
}
