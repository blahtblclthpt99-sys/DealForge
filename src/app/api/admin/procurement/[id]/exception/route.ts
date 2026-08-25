import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  hasActivePostPurchaseException,
  isPostPurchaseProcurementStatus,
  POST_PURCHASE_EVIDENCE_TYPES,
  POST_PURCHASE_EXCEPTION_REASONS,
  POST_PURCHASE_PROCUREMENT_STATUSES,
  postPurchaseExceptionEventKey,
  validatePostPurchaseRecovery,
} from "@/lib/post-purchase-exceptions";
import { readLimitedJson } from "@/lib/request-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const expectedState = z.enum(POST_PURCHASE_PROCUREMENT_STATUSES);
const note = z.string().trim().min(1).max(500).optional();
const evidenceReference = z.string().trim().min(3).max(160).regex(/^[A-Za-z0-9 ._#:/()-]+$/);
const refundKey = z.string().trim().min(12).max(128).regex(/^[A-Za-z0-9:_-]+$/);

const ActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("OPEN_POST_PURCHASE_EXCEPTION"),
    expectedState,
    reason: z.enum(POST_PURCHASE_EXCEPTION_REASONS),
    note,
  }),
  z.object({
    action: z.literal("AUTHORIZE_POST_PURCHASE_REFUND"),
    expectedState,
    manualEvidenceConfirmed: z.literal(true),
    evidenceType: z.enum(POST_PURCHASE_EVIDENCE_TYPES),
    evidenceReference,
    supplierRecoveryCents: z.number().int().nonnegative().max(100_000_000),
    authorizedCustomerRefundCents: z.number().int().positive().max(100_000_000),
    refundIdempotencyKey: refundKey,
    acceptUnrecoveredSupplierCost: z.boolean().optional(),
    note,
  }),
  z.object({
    action: z.literal("CLOSE_POST_PURCHASE_EXCEPTION"),
    expectedState,
    resolution: z.string().trim().min(3).max(240),
    note,
  }),
]);

async function authorizeAdmin() {
  try {
    return { admin: await requireAdmin(), response: null };
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
  if (auth.response || !auth.admin) {
    return noStore(auth.response || NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }));
  }

  const read = await readLimitedJson(request, 16 * 1024);
  if (!read.ok) {
    return noStore(
      NextResponse.json(
        {
          error:
            read.error === "BODY_TOO_LARGE"
              ? "POST_PURCHASE_EXCEPTION_REQUEST_TOO_LARGE"
              : "INVALID_POST_PURCHASE_EXCEPTION_ACTION",
        },
        { status: read.error === "BODY_TOO_LARGE" ? 413 : 400 },
      ),
    );
  }

  const parsed = ActionSchema.safeParse(read.value);
  if (!parsed.success) {
    return noStore(
      NextResponse.json({ error: "INVALID_POST_PURCHASE_EXCEPTION_ACTION" }, { status: 400 }),
    );
  }

  const { id } = await context.params;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.procurementIntent.findUnique({
        where: { id },
        include: {
          order: {
            select: {
              status: true,
              paidAt: true,
              refunds: { select: { status: true, idempotencyKey: true } },
            },
          },
          orderItem: { select: { lineTotalCents: true } },
          events: {
            where: {
              type: {
                in: [
                  "OPEN_POST_PURCHASE_EXCEPTION",
                  "AUTHORIZE_POST_PURCHASE_REFUND",
                  "CLOSE_POST_PURCHASE_EXCEPTION",
                ],
              },
            },
            orderBy: { createdAt: "asc" },
            select: { type: true, detail: true, createdAt: true },
          },
        },
      });

      if (!current) throw new Error("PROCUREMENT_INTENT_NOT_FOUND");
      if (current.executionMode !== "manual_only") throw new Error("PROCUREMENT_EXECUTION_MODE_UNSAFE");
      if (current.blockedReason) throw new Error("PROCUREMENT_SOURCE_INTEGRITY_BLOCKED");
      if (!current.order.paidAt || !["paid", "partially_refunded"].includes(current.order.status)) {
        throw new Error("POST_PURCHASE_EXCEPTION_ORDER_NOT_ELIGIBLE");
      }
      if (!isPostPurchaseProcurementStatus(current.status) || current.status !== parsed.data.expectedState) {
        throw new Error("POST_PURCHASE_EXCEPTION_STATE_CONFLICT");
      }

      const active = hasActivePostPurchaseException(current.events);
      if (parsed.data.action === "OPEN_POST_PURCHASE_EXCEPTION" && active) {
        throw new Error("POST_PURCHASE_EXCEPTION_ALREADY_OPEN");
      }
      if (parsed.data.action !== "OPEN_POST_PURCHASE_EXCEPTION" && !active) {
        throw new Error("POST_PURCHASE_EXCEPTION_NOT_OPEN");
      }
      if (
        parsed.data.action !== "OPEN_POST_PURCHASE_EXCEPTION" &&
        current.order.refunds.some((refund) => refund.status === "pending")
      ) {
        throw new Error("POST_PURCHASE_EXCEPTION_REFUND_PENDING");
      }

      let recovery: ReturnType<typeof validatePostPurchaseRecovery> | null = null;
      if (parsed.data.action === "AUTHORIZE_POST_PURCHASE_REFUND") {
        recovery = validatePostPurchaseRecovery({
          actualSupplierCostCents: current.actualTotalCostCents,
          supplierRecoveryCents: parsed.data.supplierRecoveryCents,
          authorizedCustomerRefundCents: parsed.data.authorizedCustomerRefundCents,
          lineRevenueCents: current.orderItem.lineTotalCents,
          acceptUnrecoveredSupplierCost: parsed.data.acceptUnrecoveredSupplierCost === true,
        });
        if (!recovery.ok) throw new Error(recovery.reason);

        const duplicateKeyRefund = current.order.refunds.find(
          (refund) => refund.idempotencyKey === parsed.data.refundIdempotencyKey,
        );
        if (duplicateKeyRefund) throw new Error("POST_PURCHASE_REFUND_KEY_ALREADY_USED");
      }

      const touched = await tx.procurementIntent.updateMany({
        where: { id: current.id, status: current.status, updatedAt: current.updatedAt },
        data: { status: current.status },
      });
      if (touched.count !== 1) throw new Error("POST_PURCHASE_EXCEPTION_CONCURRENT_CHANGE");

      const now = new Date();
      await tx.procurementEvent.create({
        data: {
          eventKey: postPurchaseExceptionEventKey(current.id, parsed.data.action, randomUUID()),
          procurementIntentId: current.id,
          type: parsed.data.action,
          actor: `admin:${auth.admin.id}`,
          detail: JSON.stringify({
            version: 1,
            procurementStatus: current.status,
            recordedAt: now.toISOString(),
            note: parsed.data.note || null,
            ...(parsed.data.action === "OPEN_POST_PURCHASE_EXCEPTION"
              ? { reason: parsed.data.reason }
              : {}),
            ...(parsed.data.action === "AUTHORIZE_POST_PURCHASE_REFUND"
              ? {
                  manualEvidenceConfirmed: true,
                  evidenceType: parsed.data.evidenceType,
                  evidenceReference: parsed.data.evidenceReference,
                  supplierRecoveryCents: parsed.data.supplierRecoveryCents,
                  actualSupplierCostCents: current.actualTotalCostCents,
                  unrecoveredSupplierCostCents: recovery?.ok
                    ? recovery.unrecoveredSupplierCostCents
                    : null,
                  projectedExceptionLossCents: recovery?.ok
                    ? recovery.projectedExceptionLossCents
                    : null,
                  acceptUnrecoveredSupplierCost:
                    parsed.data.acceptUnrecoveredSupplierCost === true,
                  authorizedCustomerRefundCents: parsed.data.authorizedCustomerRefundCents,
                  refundIdempotencyKey: parsed.data.refundIdempotencyKey,
                }
              : {}),
            ...(parsed.data.action === "CLOSE_POST_PURCHASE_EXCEPTION"
              ? { resolution: parsed.data.resolution }
              : {}),
          }),
        },
      });

      return {
        status: current.status,
        exceptionState:
          parsed.data.action === "CLOSE_POST_PURCHASE_EXCEPTION" ? "closed" : "open",
        recordedAt: now.toISOString(),
        ...(recovery?.ok
          ? {
              unrecoveredSupplierCostCents: recovery.unrecoveredSupplierCostCents,
              projectedExceptionLossCents: recovery.projectedExceptionLossCents,
            }
          : {}),
      };
    });

    return noStore(
      NextResponse.json({
        ok: true,
        procurementIntentId: id,
        automaticSupplierPurchasingEnabled: false,
        ...result,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    const notFound = message === "PROCUREMENT_INTENT_NOT_FOUND";
    const validation = [
      "ACTUAL_SUPPLIER_COST_REQUIRED",
      "SUPPLIER_RECOVERY_INVALID",
      "CUSTOMER_REFUND_AUTHORIZATION_INVALID",
      "UNRECOVERED_SUPPLIER_COST_REQUIRES_ACKNOWLEDGEMENT",
    ].includes(message);
    if (
      notFound ||
      validation ||
      message.startsWith("PROCUREMENT_") ||
      message.startsWith("POST_PURCHASE_")
    ) {
      return noStore(
        NextResponse.json(
          { error: message },
          { status: notFound ? 404 : validation ? 422 : 409 },
        ),
      );
    }
    console.error("procurement.post_purchase_exception_failed", {
      procurementIntentId: id,
      action: parsed.data.action,
      errorName: error instanceof Error ? error.name : "UNKNOWN",
    });
    return noStore(
      NextResponse.json({ error: "POST_PURCHASE_EXCEPTION_ACTION_FAILED" }, { status: 500 }),
    );
  }
}
