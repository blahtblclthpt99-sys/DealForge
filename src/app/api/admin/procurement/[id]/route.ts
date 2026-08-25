import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  isProcurementStatus,
  procurementEventKey,
  transitionProcurement,
  validateManualPurchaseEconomics,
} from "@/lib/procurement-state-machine";
import { hasActiveRefund } from "@/lib/refund-procurement-interlock";
import { readLimitedJson } from "@/lib/request-json";
import {
  isSameOriginProcurementMutation,
  requireProcurementOwner,
} from "@/lib/procurement-authorization";
import { checkProcurementSourceRevalidation } from "@/lib/procurement-source-revalidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const expectedState = z.enum(["awaiting_review", "approved_manual", "hold", "supplier_ordered_manual", "cancelled"]);
const note = z.string().trim().min(1).max(500).optional();
const supplierReference = z.string().trim().min(2).max(120).regex(/^[A-Za-z0-9 ._#:\/-]+$/);

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("APPROVE_MANUAL"), expectedState, note }),
  z.object({ action: z.literal("PLACE_HOLD"), expectedState, reason: z.string().trim().min(3).max(240), note }),
  z.object({ action: z.literal("RESUME_REVIEW"), expectedState, note }),
  z.object({
    action: z.literal("RECORD_MANUAL_PURCHASE"),
    expectedState,
    manualPurchaseConfirmed: z.literal(true),
    supplierOrderReference: supplierReference,
    actualTotalCostCents: z.number().int().positive().max(100_000_000),
    acceptCostVariance: z.boolean().optional(),
    acceptLossRisk: z.boolean().optional(),
    note,
  }),
  z.object({ action: z.literal("CANCEL"), expectedState, reason: z.string().trim().min(3).max(240), note }),
]);

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

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdmin();
  if (auth.response || !auth.admin) return noStore(auth.response || NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }));
  if (!isSameOriginProcurementMutation(request)) {
    return noStore(NextResponse.json({ error: "INVALID_ORIGIN" }, { status: 403 }));
  }

  const read = await readLimitedJson(request, 16 * 1024);
  if (!read.ok) {
    return noStore(
      NextResponse.json(
        { error: read.error === "BODY_TOO_LARGE" ? "PROCUREMENT_REQUEST_TOO_LARGE" : "INVALID_PROCUREMENT_ACTION" },
        { status: read.error === "BODY_TOO_LARGE" ? 413 : 400 },
      ),
    );
  }
  const parsed = ActionSchema.safeParse(read.value);
  if (!parsed.success) return noStore(NextResponse.json({ error: "INVALID_PROCUREMENT_ACTION" }, { status: 400 }));

  const { id } = await context.params;
  const intent = await prisma.procurementIntent.findUnique({
    where: { id },
    include: {
      order: { select: { id: true, status: true, paidAt: true, currency: true, refunds: { select: { status: true } } } },
      orderItem: { select: { id: true, productId: true, lineTotalCents: true } },
    },
  });
  if (!intent) return noStore(NextResponse.json({ error: "PROCUREMENT_INTENT_NOT_FOUND" }, { status: 404 }));
  if (intent.executionMode !== "manual_only") {
    return noStore(NextResponse.json({ error: "PROCUREMENT_EXECUTION_MODE_UNSAFE" }, { status: 409 }));
  }
  if (intent.order.status !== "paid" || !intent.order.paidAt) {
    return noStore(NextResponse.json({ error: "PROCUREMENT_ORDER_NOT_PAID" }, { status: 409 }));
  }
  if (hasActiveRefund(intent.order.refunds) && parsed.data.action !== "CANCEL") {
    return noStore(NextResponse.json({ error: "PROCUREMENT_BLOCKED_BY_REFUND" }, { status: 409 }));
  }
  if (intent.blockedReason || intent.status === "blocked_source_integrity") {
    return noStore(NextResponse.json({ error: "PROCUREMENT_SOURCE_INTEGRITY_BLOCKED" }, { status: 409 }));
  }
  if (!isProcurementStatus(intent.status)) {
    return noStore(NextResponse.json({ error: "PROCUREMENT_STATE_INVALID" }, { status: 409 }));
  }
  if (parsed.data.expectedState !== intent.status) {
    return noStore(NextResponse.json({ error: "PROCUREMENT_STATE_CONFLICT", currentState: intent.status }, { status: 409 }));
  }

  const transition = transitionProcurement(intent.status, parsed.data.action);
  if (!transition.ok) {
    return noStore(NextResponse.json({ error: transition.reason, currentState: intent.status }, { status: 409 }));
  }

  let sourceRevalidation: Awaited<ReturnType<typeof checkProcurementSourceRevalidation>> | null = null;
  if (parsed.data.action === "APPROVE_MANUAL") {
    sourceRevalidation = await checkProcurementSourceRevalidation({
      supplierSnapshot: intent.supplierSnapshot,
      productId: intent.orderItem.productId,
      currency: intent.currency,
      expectedUnitCostCents: intent.expectedUnitCostCents,
    });
    if (!sourceRevalidation.allowed) {
      return noStore(
        NextResponse.json(
          {
            error: "PROCUREMENT_LIVE_SOURCE_REVALIDATION_FAILED",
            reasons: sourceRevalidation.reasons,
          },
          { status: 409 },
        ),
      );
    }
  }

  let economics: ReturnType<typeof validateManualPurchaseEconomics> | null = null;
  if (parsed.data.action === "RECORD_MANUAL_PURCHASE") {
    economics = validateManualPurchaseEconomics({
      actualTotalCostCents: parsed.data.actualTotalCostCents,
      expectedTotalCostCents: intent.expectedTotalCostCents,
      lineRevenueCents: intent.orderItem.lineTotalCents,
      acceptCostVariance: parsed.data.acceptCostVariance === true,
      acceptLossRisk: parsed.data.acceptLossRisk === true,
    });
    if (!economics.ok) {
      return noStore(
        NextResponse.json(
          { error: economics.reason, varianceCents: "varianceCents" in economics ? economics.varianceCents : null },
          { status: 422 },
        ),
      );
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.procurementIntent.findUnique({
        where: { id: intent.id },
        include: {
          order: { select: { status: true, paidAt: true, refunds: { select: { status: true } } } },
          orderItem: { select: { productId: true, lineTotalCents: true } },
        },
      });
      if (!current) throw new Error("PROCUREMENT_INTENT_CHANGED");
      if (current.executionMode !== "manual_only" || current.blockedReason) throw new Error("PROCUREMENT_INTENT_CHANGED");
      if (current.order.status !== "paid" || !current.order.paidAt) throw new Error("PROCUREMENT_FINANCIAL_STATE_CHANGED");
      if (hasActiveRefund(current.order.refunds) && parsed.data.action !== "CANCEL") {
        throw new Error("PROCUREMENT_REFUND_INTERLOCK");
      }
      if (current.status !== parsed.data.expectedState || !isProcurementStatus(current.status)) {
        throw new Error("PROCUREMENT_STATE_CHANGED");
      }
      const txTransition = transitionProcurement(current.status, parsed.data.action);
      if (!txTransition.ok) throw new Error("PROCUREMENT_TRANSITION_CHANGED");

      let approvalSourceRevalidation = sourceRevalidation;
      if (parsed.data.action === "APPROVE_MANUAL") {
        approvalSourceRevalidation = await checkProcurementSourceRevalidation(
          {
            supplierSnapshot: current.supplierSnapshot,
            productId: current.orderItem.productId,
            currency: current.currency,
            expectedUnitCostCents: current.expectedUnitCostCents,
          },
          Date.now(),
          tx,
        );
        if (!approvalSourceRevalidation.allowed) {
          throw new Error("PROCUREMENT_LIVE_SOURCE_REVALIDATION_CHANGED");
        }
      }

      const now = new Date();
      const data: {
        status: string;
        approvedByUserId?: string;
        approvedAt?: Date;
        supplierOrderReference?: string;
        actualTotalCostCents?: number;
        executedAt?: Date;
      } = { status: txTransition.next };

      if (parsed.data.action === "APPROVE_MANUAL") {
        data.approvedByUserId = auth.admin.id;
        data.approvedAt = now;
      }
      if (parsed.data.action === "RECORD_MANUAL_PURCHASE") {
        data.supplierOrderReference = parsed.data.supplierOrderReference;
        data.actualTotalCostCents = parsed.data.actualTotalCostCents;
        data.executedAt = now;
      }

      const updated = await tx.procurementIntent.updateMany({
        where: { id: current.id, status: current.status, updatedAt: current.updatedAt },
        data,
      });
      if (updated.count !== 1) throw new Error("PROCUREMENT_CONCURRENT_CHANGE");

      const nonce = randomUUID();
      await tx.procurementEvent.create({
        data: {
          eventKey: procurementEventKey(current.id, parsed.data.action, nonce),
          procurementIntentId: current.id,
          type: parsed.data.action,
          actor: `owner:${auth.admin.id}`,
          detail: JSON.stringify({
            previousStatus: current.status,
            nextStatus: txTransition.next,
            note: parsed.data.note || null,
            reason: "reason" in parsed.data ? parsed.data.reason : null,
            automaticSupplierPurchasingEnabled: false,
            ...(parsed.data.action === "APPROVE_MANUAL" && approvalSourceRevalidation?.allowed
              ? {
                  liveSourceRevalidated: true,
                  liveSourceRevalidatedAt: now.toISOString(),
                  persistedOfferId: approvalSourceRevalidation.persistedOfferId,
                  currentLandedCostCents: approvalSourceRevalidation.currentLandedCostCents,
                }
              : {}),
            ...(parsed.data.action === "RECORD_MANUAL_PURCHASE"
              ? {
                  manualPurchaseConfirmed: true,
                  supplierOrderReference: parsed.data.supplierOrderReference,
                  actualTotalCostCents: parsed.data.actualTotalCostCents,
                  expectedTotalCostCents: current.expectedTotalCostCents,
                  lineRevenueCents: current.orderItem.lineTotalCents,
                  costVarianceCents: economics?.ok ? economics.varianceCents : null,
                  projectedGrossMarginCents: economics?.ok ? economics.projectedGrossMarginCents : null,
                  acceptCostVariance: parsed.data.acceptCostVariance === true,
                  acceptLossRisk: parsed.data.acceptLossRisk === true,
                }
              : {}),
          }),
        },
      });

      return { previousStatus: current.status, status: txTransition.next, performedAt: now.toISOString() };
    });

    return noStore(
      NextResponse.json({
        ok: true,
        procurementIntentId: intent.id,
        automaticSupplierPurchasingEnabled: false,
        ...result,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message.startsWith("PROCUREMENT_")) {
      const responseError =
        message === "PROCUREMENT_REFUND_INTERLOCK"
          ? "PROCUREMENT_BLOCKED_BY_REFUND"
          : message === "PROCUREMENT_LIVE_SOURCE_REVALIDATION_CHANGED"
            ? "PROCUREMENT_LIVE_SOURCE_REVALIDATION_FAILED"
            : "PROCUREMENT_STATE_CONFLICT";
      return noStore(NextResponse.json({ error: responseError }, { status: 409 }));
    }
    console.error("procurement.owner_action_failed", {
      procurementIntentId: intent.id,
      action: parsed.data.action,
      errorName: error instanceof Error ? error.name : "UNKNOWN",
    });
    return noStore(NextResponse.json({ error: "PROCUREMENT_ACTION_FAILED" }, { status: 500 }));
  }
}
