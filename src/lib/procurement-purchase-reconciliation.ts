import { createHash } from "node:crypto";
import { prisma } from "./db";
import {
  deriveManualPurchaseExecutionEvidence,
  manualPurchaseExecutionEventKey,
  readManualPurchaseExecutionEvidence,
  type ManualPurchaseExecutionEvidenceV1,
} from "./procurement-purchase-evidence";
import { deriveProcurementSourceLock } from "./procurement-source-lock";

export const PURCHASE_RECONCILIATION_BLOCKED_REASON = "manual_purchase_reconciliation_failed";
const COMPLETED_PURCHASE_STATUSES = new Set(["supplier_ordered_manual", "shipped", "delivered"]);

export type PurchaseReconciliationReason =
  | "purchase_completion_event_missing"
  | "purchase_completion_event_duplicate"
  | "purchase_completion_event_invalid"
  | "purchase_completion_event_key_mismatch"
  | "purchase_status_mismatch"
  | "supplier_order_reference_mismatch"
  | "actual_total_cost_mismatch"
  | "execution_timestamp_missing"
  | "quantity_mismatch"
  | "currency_mismatch"
  | "expected_total_cost_mismatch"
  | "line_revenue_mismatch"
  | "source_lock_invalid"
  | "source_lock_mismatch"
  | "supplier_identity_mismatch"
  | "supplier_offer_mismatch"
  | "purchase_evidence_hash_mismatch";

type ReconciliationProjection = {
  status: string;
  supplierSnapshot: string;
  quantity: number;
  expectedUnitCostCents: number | null;
  expectedTotalCostCents: number | null;
  currency: string;
  supplierOrderReference: string | null;
  actualTotalCostCents: number | null;
  executedAt: Date | null;
  orderItem: { lineTotalCents: number };
  events: Array<{ eventKey: string; detail: string }>;
};

export type PurchaseReconciliationResult = {
  ok: boolean;
  reasons: PurchaseReconciliationReason[];
  evidence: ManualPurchaseExecutionEvidenceV1 | null;
};

function uniqueReasons(reasons: PurchaseReconciliationReason[]) {
  return [...new Set(reasons)];
}

export function reconcileManualPurchaseProjection(
  projection: ReconciliationProjection,
): PurchaseReconciliationResult {
  const reasons: PurchaseReconciliationReason[] = [];
  if (!COMPLETED_PURCHASE_STATUSES.has(projection.status)) reasons.push("purchase_status_mismatch");

  if (projection.events.length === 0) {
    reasons.push("purchase_completion_event_missing");
    return { ok: false, reasons: uniqueReasons(reasons), evidence: null };
  }
  if (projection.events.length !== 1) reasons.push("purchase_completion_event_duplicate");

  const event = projection.events[0];
  const evidence = readManualPurchaseExecutionEvidence(event.detail);
  if (!evidence) {
    reasons.push("purchase_completion_event_invalid");
    return { ok: false, reasons: uniqueReasons(reasons), evidence: null };
  }

  if (event.eventKey !== manualPurchaseExecutionEventKey(evidence)) {
    reasons.push("purchase_completion_event_key_mismatch");
  }
  if (projection.supplierOrderReference !== evidence.supplierOrderReference) {
    reasons.push("supplier_order_reference_mismatch");
  }
  if (projection.actualTotalCostCents !== evidence.actualTotalCostCents) {
    reasons.push("actual_total_cost_mismatch");
  }
  if (!projection.executedAt) reasons.push("execution_timestamp_missing");
  if (projection.quantity !== evidence.quantity) reasons.push("quantity_mismatch");
  if (projection.currency.trim().toLowerCase() !== evidence.currency) reasons.push("currency_mismatch");
  if (projection.expectedTotalCostCents !== evidence.expectedTotalCostCents) {
    reasons.push("expected_total_cost_mismatch");
  }
  if (projection.orderItem.lineTotalCents !== evidence.lineRevenueCents) reasons.push("line_revenue_mismatch");

  const sourceLock = deriveProcurementSourceLock(
    projection.supplierSnapshot,
    projection.expectedUnitCostCents,
    projection.currency,
  );
  if (!sourceLock) {
    reasons.push("source_lock_invalid");
  } else {
    if (sourceLock.sourceLockKey !== evidence.sourceLockKey) reasons.push("source_lock_mismatch");
    if (sourceLock.persistedSupplierId !== evidence.persistedSupplierId) reasons.push("supplier_identity_mismatch");
    if (sourceLock.persistedOfferId !== evidence.persistedOfferId) reasons.push("supplier_offer_mismatch");
  }

  const recomputed = deriveManualPurchaseExecutionEvidence({
    sourceLock,
    supplierOrderReference: projection.supplierOrderReference || "",
    quantity: projection.quantity,
    currency: projection.currency,
    actualTotalCostCents: projection.actualTotalCostCents ?? 0,
    expectedTotalCostCents: projection.expectedTotalCostCents,
    lineRevenueCents: projection.orderItem.lineTotalCents,
  });
  if (!recomputed || recomputed.purchaseEvidenceHash !== evidence.purchaseEvidenceHash) {
    reasons.push("purchase_evidence_hash_mismatch");
  }

  const normalized = uniqueReasons(reasons);
  return { ok: normalized.length === 0, reasons: normalized, evidence };
}

function reconciliationEventKey(intentId: string, projection: ReconciliationProjection, result: PurchaseReconciliationResult) {
  const canonical = JSON.stringify({
    status: projection.status,
    supplierOrderReference: projection.supplierOrderReference,
    actualTotalCostCents: projection.actualTotalCostCents,
    executedAt: projection.executedAt?.toISOString() || null,
    quantity: projection.quantity,
    currency: projection.currency,
    expectedTotalCostCents: projection.expectedTotalCostCents,
    lineRevenueCents: projection.orderItem.lineTotalCents,
    evidenceHash: result.evidence?.purchaseEvidenceHash || null,
    reasons: result.reasons,
  });
  const digest = createHash("sha256").update(canonical).digest("hex");
  return `procurement-purchase-reconciliation:${intentId}:${digest}`;
}

export async function sweepManualPurchaseReconciliation(actor = "system", requestedLimit = 250) {
  const limit = Math.max(1, Math.min(500, Math.trunc(requestedLimit) || 250));
  const intents = await prisma.procurementIntent.findMany({
    where: {
      executionMode: "manual_only",
      OR: [
        { status: { in: ["supplier_ordered_manual", "shipped", "delivered"] } },
        { supplierOrderReference: { not: null } },
        { actualTotalCostCents: { not: null } },
        { executedAt: { not: null } },
        { events: { some: { type: "RECORD_MANUAL_PURCHASE" } } },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    include: {
      orderItem: { select: { lineTotalCents: true } },
      events: {
        where: { type: "RECORD_MANUAL_PURCHASE" },
        orderBy: { createdAt: "asc" },
        select: { eventKey: true, detail: true },
      },
    },
  });

  let healthy = 0;
  let quarantined = 0;
  let alreadyBlocked = 0;
  const errors: Array<{ procurementIntentId: string; error: string }> = [];

  for (const intent of intents) {
    const result = reconcileManualPurchaseProjection(intent);
    if (result.ok) {
      healthy += 1;
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        const current = await tx.procurementIntent.findUnique({
          where: { id: intent.id },
          include: {
            orderItem: { select: { lineTotalCents: true } },
            events: {
              where: { type: "RECORD_MANUAL_PURCHASE" },
              orderBy: { createdAt: "asc" },
              select: { eventKey: true, detail: true },
            },
          },
        });
        if (!current || current.executionMode !== "manual_only") return;

        const currentResult = reconcileManualPurchaseProjection(current);
        if (currentResult.ok) return;

        const eventKey = reconciliationEventKey(current.id, current, currentResult);
        await tx.procurementEvent.upsert({
          where: { eventKey },
          update: {},
          create: {
            eventKey,
            procurementIntentId: current.id,
            type: "PURCHASE_RECONCILIATION_FAILED",
            actor,
            detail: JSON.stringify({
              reasons: currentResult.reasons,
              previousBlockedReason: current.blockedReason,
              statusPreserved: current.status,
              supplierOrderReference: current.supplierOrderReference,
              actualTotalCostCents: current.actualTotalCostCents,
              quantity: current.quantity,
              currency: current.currency,
              expectedTotalCostCents: current.expectedTotalCostCents,
              lineRevenueCents: current.orderItem.lineTotalCents,
              evidenceHash: currentResult.evidence?.purchaseEvidenceHash || null,
              automaticSupplierPurchasingEnabled: false,
            }),
          },
        });

        if (!current.blockedReason) {
          const updated = await tx.procurementIntent.updateMany({
            where: { id: current.id, blockedReason: null, updatedAt: current.updatedAt },
            data: { blockedReason: PURCHASE_RECONCILIATION_BLOCKED_REASON },
          });
          if (updated.count !== 1) throw new Error("PROCUREMENT_RECONCILIATION_CONCURRENT_CHANGE");
          quarantined += 1;
        } else {
          alreadyBlocked += 1;
        }
      });
    } catch (error) {
      errors.push({
        procurementIntentId: intent.id,
        error: error instanceof Error ? error.message : "UNKNOWN",
      });
    }
  }

  return {
    scanned: intents.length,
    healthy,
    quarantined,
    alreadyBlocked,
    errors,
    automaticSupplierPurchasingEnabled: false,
  };
}
