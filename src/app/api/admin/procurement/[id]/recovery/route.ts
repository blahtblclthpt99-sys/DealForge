import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  projectRecoveryReconciliation,
  recoveryEventKey,
  recoveryRequestHash,
  type RecoveryEventType,
} from "@/lib/recovery-reconciliation";
import { readLimitedJson } from "@/lib/request-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const key = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9:_-]+$/);
const reference = z.string().trim().min(2).max(160).regex(/^[A-Za-z0-9 ._#:\/-]+$/);
const note = z.string().trim().min(8).max(500);

const ActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("RECORD_CUSTOMER_RETURN_RECEIVED"),
    refundIdempotencyKey: key,
    operationKey: key,
    quantity: z.number().int().positive().max(1000),
    returnReference: reference,
    note: note.optional(),
  }),
  z.object({
    action: z.literal("RECORD_SUPPLIER_RETURN_SENT"),
    refundIdempotencyKey: key,
    operationKey: key,
    quantity: z.number().int().positive().max(1000),
    supplierReturnReference: reference,
    note: note.optional(),
  }),
  z.object({
    action: z.literal("RECORD_SUPPLIER_RECOVERY"),
    refundIdempotencyKey: key,
    operationKey: key,
    amountCents: z.number().int().positive().max(100_000_000),
    supplierRecoveryReference: reference,
    note: note.optional(),
  }),
  z.object({
    action: z.literal("ACCEPT_UNRECOVERED_LOSS"),
    refundIdempotencyKey: key,
    operationKey: key,
    amountCents: z.number().int().positive().max(100_000_000),
    reason: note,
  }),
  z.object({
    action: z.literal("CLOSE_RECOVERY"),
    refundIdempotencyKey: key,
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

function eventTypeForAction(action: z.infer<typeof ActionSchema>["action"]): RecoveryEventType {
  switch (action) {
    case "RECORD_CUSTOMER_RETURN_RECEIVED":
      return "CUSTOMER_RETURN_RECEIVED";
    case "RECORD_SUPPLIER_RETURN_SENT":
      return "SUPPLIER_RETURN_SENT";
    case "RECORD_SUPPLIER_RECOVERY":
      return "SUPPLIER_RECOVERY_RECORDED";
    case "ACCEPT_UNRECOVERED_LOSS":
      return "UNRECOVERED_LOSS_ACCEPTED";
    case "CLOSE_RECOVERY":
      return "RECOVERY_RECONCILED";
  }
}

function parseDetail(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function loadIntent(id: string) {
  return prisma.procurementIntent.findUnique({
    where: { id },
    include: {
      events: { orderBy: { createdAt: "asc" }, take: 250 },
      order: {
        select: {
          id: true,
          refunds: {
            select: { idempotencyKey: true, status: true, amountCents: true },
          },
        },
      },
    },
  });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdmin();
  if (auth.response) return noStore(auth.response);

  const { id } = await context.params;
  const refundIdempotencyKey = new URL(request.url).searchParams.get("refundKey")?.trim() || "";
  if (!key.safeParse(refundIdempotencyKey).success) {
    return noStore(NextResponse.json({ error: "INVALID_RECOVERY_REFUND_KEY" }, { status: 400 }));
  }

  const intent = await loadIntent(id);
  if (!intent) return noStore(NextResponse.json({ error: "PROCUREMENT_INTENT_NOT_FOUND" }, { status: 404 }));
  if (intent.events.length >= 250) {
    return noStore(NextResponse.json({ error: "RECOVERY_EVENT_HISTORY_LIMIT" }, { status: 409 }));
  }
  const refund =
    intent.order.refunds.find((candidate) => candidate.idempotencyKey === refundIdempotencyKey) || null;
  const recovery = projectRecoveryReconciliation({
    events: intent.events,
    refund,
    refundIdempotencyKey,
    actualTotalCostCents: intent.actualTotalCostCents,
    intentQuantity: intent.quantity,
  });
  return noStore(NextResponse.json({ recovery, automaticRecoveryEnabled: false }));
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
        { error: read.error === "BODY_TOO_LARGE" ? "RECOVERY_REQUEST_TOO_LARGE" : "INVALID_RECOVERY_ACTION" },
        { status: read.error === "BODY_TOO_LARGE" ? 413 : 400 },
      ),
    );
  }
  const parsed = ActionSchema.safeParse(read.value);
  if (!parsed.success) {
    return noStore(NextResponse.json({ error: "INVALID_RECOVERY_ACTION" }, { status: 400 }));
  }

  const { id } = await context.params;
  const action = parsed.data;
  const eventType = eventTypeForAction(action.action);
  const operationKey = "operationKey" in action ? action.operationKey : "single";
  const eventKey = recoveryEventKey(id, action.refundIdempotencyKey, eventType, operationKey);
  const requestHash = recoveryRequestHash(action);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const intent = await tx.procurementIntent.findUnique({
        where: { id },
        include: {
          events: { orderBy: { createdAt: "asc" }, take: 250 },
          order: {
            select: {
              id: true,
              refunds: {
                select: { idempotencyKey: true, status: true, amountCents: true },
              },
            },
          },
        },
      });
      if (!intent) throw new Error("RECOVERY_INTENT_NOT_FOUND");
      if (intent.events.length >= 250) throw new Error("RECOVERY_EVENT_HISTORY_LIMIT");
      if (!intent.actualTotalCostCents || intent.actualTotalCostCents <= 0) {
        throw new Error("RECOVERY_SUPPLIER_COST_UNKNOWN");
      }

      const refund =
        intent.order.refunds.find(
          (candidate) => candidate.idempotencyKey === action.refundIdempotencyKey,
        ) || null;
      if (!refund || !["pending", "succeeded"].includes(refund.status)) {
        throw new Error("RECOVERY_REFUND_NOT_ACTIVE");
      }
      if (action.action === "ACCEPT_UNRECOVERED_LOSS" && refund.status !== "succeeded") {
        throw new Error("RECOVERY_LOSS_REQUIRES_SUCCEEDED_REFUND");
      }

      const before = projectRecoveryReconciliation({
        events: intent.events,
        refund,
        refundIdempotencyKey: action.refundIdempotencyKey,
        actualTotalCostCents: intent.actualTotalCostCents,
        intentQuantity: intent.quantity,
      });
      if (!before.ok) throw new Error(before.reason);

      const existing = intent.events.find((event) => event.eventKey === eventKey);
      if (existing) {
        const detail = parseDetail(existing.detail);
        if (detail?.requestHash !== requestHash && action.action !== "CLOSE_RECOVERY") {
          throw new Error("RECOVERY_KEY_CONFLICT");
        }
        return { duplicate: true, recovery: before };
      }
      if (before.closed) throw new Error("RECOVERY_ALREADY_CLOSED");

      if (
        action.action === "RECORD_CUSTOMER_RETURN_RECEIVED" &&
        action.quantity + before.customerReturnedQuantity > intent.quantity
      ) {
        throw new Error("RECOVERY_RETURN_QUANTITY_EXCEEDS_PURCHASE");
      }
      if (
        action.action === "RECORD_SUPPLIER_RETURN_SENT" &&
        action.quantity + before.supplierReturnSentQuantity > intent.quantity
      ) {
        throw new Error("RECOVERY_SUPPLIER_RETURN_QUANTITY_EXCEEDS_PURCHASE");
      }
      if (
        action.action === "RECORD_SUPPLIER_RETURN_SENT" &&
        before.recoveryPlan !== "supplier_return_required"
      ) {
        throw new Error("RECOVERY_SUPPLIER_RETURN_NOT_PLANNED");
      }
      if (
        action.action === "RECORD_CUSTOMER_RETURN_RECEIVED" &&
        !["customer_return_required", "supplier_return_required"].includes(before.recoveryPlan)
      ) {
        throw new Error("RECOVERY_CUSTOMER_RETURN_NOT_PLANNED");
      }
      if (
        (action.action === "RECORD_SUPPLIER_RECOVERY" || action.action === "ACCEPT_UNRECOVERED_LOSS") &&
        before.targetSupplierExposureCents !== null
      ) {
        const amountCents = action.amountCents;
        if (before.accountedSupplierExposureCents + amountCents > before.targetSupplierExposureCents) {
          throw new Error("RECOVERY_ACCOUNTING_EXCEEDS_SUPPLIER_COST");
        }
      }
      if (action.action === "CLOSE_RECOVERY" && !before.canClose) {
        throw new Error("RECOVERY_NOT_RECONCILED");
      }

      const now = new Date();
      const locked = await tx.procurementIntent.updateMany({
        where: { id: intent.id, updatedAt: intent.updatedAt },
        data: { updatedAt: now },
      });
      if (locked.count !== 1) throw new Error("RECOVERY_CONCURRENT_CHANGE");

      const detail: Record<string, unknown> = {
        version: 1,
        refundIdempotencyKey: action.refundIdempotencyKey,
        recoveryPlan: before.recoveryPlan,
        recordedAt: now.toISOString(),
        requestHash,
        automaticRecoveryEnabled: false,
      };
      if (action.action === "RECORD_CUSTOMER_RETURN_RECEIVED") {
        Object.assign(detail, {
          quantity: action.quantity,
          returnReference: action.returnReference,
          note: action.note || null,
        });
      } else if (action.action === "RECORD_SUPPLIER_RETURN_SENT") {
        Object.assign(detail, {
          quantity: action.quantity,
          supplierReturnReference: action.supplierReturnReference,
          note: action.note || null,
        });
      } else if (action.action === "RECORD_SUPPLIER_RECOVERY") {
        Object.assign(detail, {
          amountCents: action.amountCents,
          supplierRecoveryReference: action.supplierRecoveryReference,
          note: action.note || null,
        });
      } else if (action.action === "ACCEPT_UNRECOVERED_LOSS") {
        Object.assign(detail, {
          amountCents: action.amountCents,
          reason: action.reason,
          explicitLossAcceptance: true,
        });
      } else {
        Object.assign(detail, {
          targetSupplierExposureCents: before.targetSupplierExposureCents,
          supplierRecoveredCents: before.supplierRecoveredCents,
          acceptedLossCents: before.acceptedLossCents,
          customerReturnedQuantity: before.customerReturnedQuantity,
          supplierReturnSentQuantity: before.supplierReturnSentQuantity,
          refundStatus: refund.status,
        });
      }

      const created = await tx.procurementEvent.create({
        data: {
          eventKey,
          procurementIntentId: intent.id,
          type: eventType,
          actor: `admin:${auth.admin.id}`,
          detail: JSON.stringify(detail),
        },
      });

      const after = projectRecoveryReconciliation({
        events: [...intent.events, created],
        refund,
        refundIdempotencyKey: action.refundIdempotencyKey,
        actualTotalCostCents: intent.actualTotalCostCents,
        intentQuantity: intent.quantity,
      });
      return { duplicate: false, recovery: after };
    });

    return noStore(
      NextResponse.json({
        ok: true,
        procurementIntentId: id,
        action: action.action,
        automaticRecoveryEnabled: false,
        ...result,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    const map: Record<string, number> = {
      RECOVERY_INTENT_NOT_FOUND: 404,
      RECOVERY_EVENT_HISTORY_LIMIT: 409,
      RECOVERY_SUPPLIER_COST_UNKNOWN: 409,
      RECOVERY_REFUND_NOT_ACTIVE: 409,
      RECOVERY_LOSS_REQUIRES_SUCCEEDED_REFUND: 409,
      RECOVERY_EXCEPTION_NOT_FOUND: 409,
      RECOVERY_EXCEPTION_EVENT_INVALID: 409,
      RECOVERY_KEY_CONFLICT: 409,
      RECOVERY_ALREADY_CLOSED: 409,
      RECOVERY_CONCURRENT_CHANGE: 409,
      RECOVERY_RETURN_QUANTITY_EXCEEDS_PURCHASE: 422,
      RECOVERY_SUPPLIER_RETURN_QUANTITY_EXCEEDS_PURCHASE: 422,
      RECOVERY_SUPPLIER_RETURN_NOT_PLANNED: 422,
      RECOVERY_CUSTOMER_RETURN_NOT_PLANNED: 422,
      RECOVERY_ACCOUNTING_EXCEEDS_SUPPLIER_COST: 422,
      RECOVERY_NOT_RECONCILED: 422,
    };
    if (map[message]) {
      return noStore(NextResponse.json({ error: message }, { status: map[message] }));
    }
    console.error("procurement.recovery_action_failed", {
      procurementIntentId: id,
      action: action.action,
      errorName: error instanceof Error ? error.name : "UNKNOWN",
    });
    return noStore(NextResponse.json({ error: "RECOVERY_ACTION_FAILED" }, { status: 500 }));
  }
}
