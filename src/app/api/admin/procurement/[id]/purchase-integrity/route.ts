import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  isSameOriginProcurementMutation,
  requireProcurementOwner,
} from "@/lib/procurement-authorization";
import {
  PURCHASE_RECONCILIATION_BLOCKED_REASON,
} from "@/lib/procurement-purchase-reconciliation";
import {
  PURCHASE_RECONCILIATION_RESOLUTION_EVENT,
  PURCHASE_RECONCILIATION_RESOLUTION_TOKEN_PREFIX,
  projectPurchaseReconciliationRecovery,
  purchaseReconciliationResolutionEventKey,
} from "@/lib/procurement-reconciliation-recovery";
import { readLimitedJson } from "@/lib/request-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const resolutionToken = z
  .string()
  .trim()
  .regex(new RegExp(`^${PURCHASE_RECONCILIATION_RESOLUTION_TOKEN_PREFIX}[a-f0-9]{64}$`));

const ActionSchema = z.object({
  action: z.literal("RESOLVE_PURCHASE_RECONCILIATION"),
  resolutionToken,
  acknowledgedEvidenceMatch: z.literal(true),
  note: z.string().trim().min(8).max(500),
});

async function authorizeAdmin() {
  try {
    return { admin: await requireProcurementOwner(), response: null };
  } catch (error) {
    const status = error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 403;
    return {
      admin: null,
      response: NextResponse.json(
        { error: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" },
        { status },
      ),
    };
  }
}

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

async function loadPurchaseIntegrity(id: string) {
  const intent = await prisma.procurementIntent.findUnique({
    where: { id },
    include: {
      orderItem: { select: { lineTotalCents: true } },
    },
  });
  if (!intent) return null;

  const [purchaseEvents, auditEvents] = await Promise.all([
    prisma.procurementEvent.findMany({
      where: { procurementIntentId: id, type: "RECORD_MANUAL_PURCHASE" },
      orderBy: { createdAt: "asc" },
      take: 2,
      select: { eventKey: true, detail: true },
    }),
    prisma.procurementEvent.findMany({
      where: {
        procurementIntentId: id,
        type: { in: ["PURCHASE_RECONCILIATION_FAILED", PURCHASE_RECONCILIATION_RESOLUTION_EVENT] },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { type: true, detail: true, createdAt: true },
    }),
  ]);

  return {
    intent,
    projection: projectPurchaseReconciliationRecovery({
      id: intent.id,
      blockedReason: intent.blockedReason,
      updatedAt: intent.updatedAt,
      status: intent.status,
      supplierSnapshot: intent.supplierSnapshot,
      quantity: intent.quantity,
      expectedUnitCostCents: intent.expectedUnitCostCents,
      expectedTotalCostCents: intent.expectedTotalCostCents,
      currency: intent.currency,
      supplierOrderReference: intent.supplierOrderReference,
      actualTotalCostCents: intent.actualTotalCostCents,
      executedAt: intent.executedAt,
      orderItem: intent.orderItem,
      purchaseEvents,
      auditEvents,
    }),
  };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdmin();
  if (auth.response) return noStore(auth.response);

  const { id } = await context.params;
  const loaded = await loadPurchaseIntegrity(id);
  if (!loaded) {
    return noStore(NextResponse.json({ error: "PROCUREMENT_INTENT_NOT_FOUND" }, { status: 404 }));
  }
  if (loaded.intent.executionMode !== "manual_only") {
    return noStore(
      NextResponse.json({ error: "PROCUREMENT_EXECUTION_MODE_UNSAFE" }, { status: 409 }),
    );
  }

  return noStore(
    NextResponse.json({
      procurementIntentId: loaded.intent.id,
      executionMode: loaded.intent.executionMode,
      automaticSupplierPurchasingEnabled: false,
      resolutionRequiresOwnerConfirmation: true,
      purchaseIntegrity: loaded.projection,
    }),
  );
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdmin();
  if (auth.response || !auth.admin) {
    return noStore(auth.response || NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }));
  }
  if (!isSameOriginProcurementMutation(request)) {
    return noStore(NextResponse.json({ error: "INVALID_ORIGIN" }, { status: 403 }));
  }

  const read = await readLimitedJson(request, 16 * 1024);
  if (!read.ok) {
    return noStore(
      NextResponse.json(
        {
          error:
            read.error === "BODY_TOO_LARGE"
              ? "PURCHASE_RECONCILIATION_RECOVERY_REQUEST_TOO_LARGE"
              : "INVALID_PURCHASE_RECONCILIATION_RECOVERY_ACTION",
        },
        { status: read.error === "BODY_TOO_LARGE" ? 413 : 400 },
      ),
    );
  }
  const parsed = ActionSchema.safeParse(read.value);
  if (!parsed.success) {
    return noStore(
      NextResponse.json(
        { error: "INVALID_PURCHASE_RECONCILIATION_RECOVERY_ACTION" },
        { status: 400 },
      ),
    );
  }

  const { id } = await context.params;
  const action = parsed.data;
  const deterministicEventKey = purchaseReconciliationResolutionEventKey(id, action.resolutionToken);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "ProcurementIntent" WHERE "id" = ${id} FOR UPDATE
      `;
      if (locked.length !== 1) {
        return { ok: false as const, error: "PROCUREMENT_INTENT_NOT_FOUND", status: 404 };
      }

      const intent = await tx.procurementIntent.findUnique({
        where: { id },
        include: { orderItem: { select: { lineTotalCents: true } } },
      });
      if (!intent) {
        return { ok: false as const, error: "PROCUREMENT_INTENT_NOT_FOUND", status: 404 };
      }
      if (intent.executionMode !== "manual_only") {
        return { ok: false as const, error: "PROCUREMENT_EXECUTION_MODE_UNSAFE", status: 409 };
      }

      if (intent.blockedReason !== PURCHASE_RECONCILIATION_BLOCKED_REASON) {
        if (!intent.blockedReason) {
          const previousResolution = await tx.procurementEvent.findUnique({
            where: { eventKey: deterministicEventKey },
            select: { id: true, createdAt: true },
          });
          if (previousResolution) {
            return {
              ok: true as const,
              duplicate: true,
              statusPreserved: intent.status,
              resolvedAt: previousResolution.createdAt.toISOString(),
            };
          }
        }
        return {
          ok: false as const,
          error: intent.blockedReason
            ? "PROCUREMENT_DIFFERENT_INTEGRITY_BLOCK_ACTIVE"
            : "PROCUREMENT_RECONCILIATION_BLOCK_NOT_ACTIVE",
          status: 409,
        };
      }

      const [purchaseEvents, auditEvents] = await Promise.all([
        tx.procurementEvent.findMany({
          where: { procurementIntentId: id, type: "RECORD_MANUAL_PURCHASE" },
          orderBy: { createdAt: "asc" },
          take: 2,
          select: { eventKey: true, detail: true },
        }),
        tx.procurementEvent.findMany({
          where: {
            procurementIntentId: id,
            type: { in: ["PURCHASE_RECONCILIATION_FAILED", PURCHASE_RECONCILIATION_RESOLUTION_EVENT] },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { type: true, detail: true, createdAt: true },
        }),
      ]);

      const purchaseIntegrity = projectPurchaseReconciliationRecovery({
        id: intent.id,
        blockedReason: intent.blockedReason,
        updatedAt: intent.updatedAt,
        status: intent.status,
        supplierSnapshot: intent.supplierSnapshot,
        quantity: intent.quantity,
        expectedUnitCostCents: intent.expectedUnitCostCents,
        expectedTotalCostCents: intent.expectedTotalCostCents,
        currency: intent.currency,
        supplierOrderReference: intent.supplierOrderReference,
        actualTotalCostCents: intent.actualTotalCostCents,
        executedAt: intent.executedAt,
        orderItem: intent.orderItem,
        purchaseEvents,
        auditEvents,
      });

      if (!purchaseIntegrity.reconciliation.ok || !purchaseIntegrity.canResolve) {
        return {
          ok: false as const,
          error: "PROCUREMENT_RECONCILIATION_STILL_FAILED",
          status: 409,
          reasons: purchaseIntegrity.reconciliation.reasons,
        };
      }
      if (!purchaseIntegrity.resolutionToken || purchaseIntegrity.resolutionToken !== action.resolutionToken) {
        return {
          ok: false as const,
          error: "PROCUREMENT_RECONCILIATION_RESOLUTION_TOKEN_STALE",
          status: 409,
        };
      }
      if (!purchaseIntegrity.immutableExecutionEvidence) {
        return {
          ok: false as const,
          error: "PROCUREMENT_RECONCILIATION_EVIDENCE_MISSING",
          status: 409,
        };
      }

      const updated = await tx.procurementIntent.updateMany({
        where: {
          id: intent.id,
          blockedReason: PURCHASE_RECONCILIATION_BLOCKED_REASON,
          updatedAt: intent.updatedAt,
        },
        data: { blockedReason: null },
      });
      if (updated.count !== 1) {
        throw new Error("PROCUREMENT_RECONCILIATION_RECOVERY_CONCURRENT_CHANGE");
      }

      const now = new Date();
      await tx.procurementEvent.create({
        data: {
          eventKey: deterministicEventKey,
          procurementIntentId: intent.id,
          type: PURCHASE_RECONCILIATION_RESOLUTION_EVENT,
          actor: `owner:${auth.admin.id}`,
          detail: JSON.stringify({
            version: 1,
            resolutionToken: action.resolutionToken,
            acknowledgedEvidenceMatch: true,
            note: action.note,
            previousBlockedReason: PURCHASE_RECONCILIATION_BLOCKED_REASON,
            statusPreserved: intent.status,
            purchaseEvidenceHash:
              purchaseIntegrity.immutableExecutionEvidence.purchaseEvidenceHash,
            sourceLockKey: purchaseIntegrity.immutableExecutionEvidence.sourceLockKey,
            supplierOrderKey: purchaseIntegrity.immutableExecutionEvidence.supplierOrderKey,
            supplierOrderReference:
              purchaseIntegrity.immutableExecutionEvidence.supplierOrderReference,
            actualTotalCostCents:
              purchaseIntegrity.immutableExecutionEvidence.actualTotalCostCents,
            quantity: purchaseIntegrity.immutableExecutionEvidence.quantity,
            currency: purchaseIntegrity.immutableExecutionEvidence.currency,
            reconciledAt: now.toISOString(),
            automaticSupplierPurchasingEnabled: false,
          }),
        },
      });

      return {
        ok: true as const,
        duplicate: false,
        statusPreserved: intent.status,
        resolvedAt: now.toISOString(),
      };
    });

    if (!result.ok) {
      return noStore(
        NextResponse.json(
          {
            error: result.error,
            ...(result.reasons ? { reasons: result.reasons } : {}),
            automaticSupplierPurchasingEnabled: false,
          },
          { status: result.status },
        ),
      );
    }

    return noStore(
      NextResponse.json({
        ok: true,
        procurementIntentId: id,
        action: action.action,
        duplicate: result.duplicate,
        statusPreserved: result.statusPreserved,
        resolvedAt: result.resolvedAt,
        automaticSupplierPurchasingEnabled: false,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "PROCUREMENT_RECONCILIATION_RECOVERY_CONCURRENT_CHANGE") {
      return noStore(
        NextResponse.json(
          { error: message, automaticSupplierPurchasingEnabled: false },
          { status: 409 },
        ),
      );
    }
    console.error("procurement.purchase_reconciliation_recovery_failed", {
      procurementIntentId: id,
      errorName: error instanceof Error ? error.name : "UNKNOWN",
    });
    return noStore(
      NextResponse.json(
        { error: "PROCUREMENT_RECONCILIATION_RECOVERY_FAILED" },
        { status: 500 },
      ),
    );
  }
}
