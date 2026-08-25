import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  evaluateRefundProcurementInterlock,
  refundInterlockEventKey,
} from "@/lib/refund-procurement-interlock";
import {
  findPostPurchaseRefundClearance,
  isPostPurchaseProcurementStatus,
  postPurchaseRefundExecutionEventKey,
} from "@/lib/post-purchase-exceptions";
import { readLimitedJson } from "@/lib/request-json";
import { createStripeRefund } from "@/lib/stripe-commerce";

export const runtime = "nodejs";

const RefundSchema = z.object({
  orderId: z.string().trim().min(1).max(128),
  amountCents: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(12).max(128).regex(/^[A-Za-z0-9:_-]+$/),
  reason: z.enum(["duplicate", "fraudulent", "requested_by_customer"]).optional(),
  postPurchaseAllocations: z
    .array(
      z.object({
        procurementIntentId: z.string().trim().min(1).max(128),
        refundAmountCents: z.number().int().positive().max(100_000_000),
      }),
    )
    .min(1)
    .max(8)
    .optional(),
});

type ProcurementWithEvents = {
  id: string;
  status: string;
  events: Array<{ type: string; detail: string; createdAt: Date }>;
};

function validatePostPurchaseRefund(input: {
  intents: ProcurementWithEvents[];
  blockingIntentIds: string[];
  idempotencyKey: string;
  amountCents: number;
  allocations:
    | Array<{ procurementIntentId: string; refundAmountCents: number }>
    | undefined;
}) {
  const allocations = input.allocations;
  if (!allocations) {
    return { ok: false as const, reason: "POST_PURCHASE_REFUND_CLEARANCE_REQUIRED" as const };
  }

  const ids = allocations.map((allocation) => allocation.procurementIntentId);
  if (new Set(ids).size !== ids.length) {
    return { ok: false as const, reason: "POST_PURCHASE_REFUND_DUPLICATE_ALLOCATION" as const };
  }

  const expectedIds = [...input.blockingIntentIds].sort();
  const actualIds = [...ids].sort();
  if (
    expectedIds.length !== actualIds.length ||
    expectedIds.some((id, index) => id !== actualIds[index])
  ) {
    return { ok: false as const, reason: "POST_PURCHASE_REFUND_ALLOCATION_SCOPE_INVALID" as const };
  }

  const total = allocations.reduce((sum, allocation) => sum + allocation.refundAmountCents, 0);
  if (!Number.isSafeInteger(total) || total !== input.amountCents) {
    return { ok: false as const, reason: "POST_PURCHASE_REFUND_ALLOCATION_TOTAL_MISMATCH" as const };
  }

  for (const allocation of allocations) {
    const intent = input.intents.find((candidate) => candidate.id === allocation.procurementIntentId);
    if (!intent || !isPostPurchaseProcurementStatus(intent.status)) {
      return { ok: false as const, reason: "POST_PURCHASE_REFUND_INTENT_STATE_INVALID" as const };
    }
    const clearance = findPostPurchaseRefundClearance(intent.events, input.idempotencyKey);
    if (!clearance || clearance.authorizedCustomerRefundCents !== allocation.refundAmountCents) {
      return { ok: false as const, reason: "POST_PURCHASE_REFUND_CLEARANCE_MISMATCH" as const };
    }
  }

  return { ok: true as const, allocations };
}

export async function POST(request: Request) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    const status = error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 403;
    return NextResponse.json({ error: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" }, { status });
  }

  const read = await readLimitedJson(request, 16 * 1024);
  if (!read.ok) {
    return NextResponse.json(
      { error: read.error === "BODY_TOO_LARGE" ? "REFUND_REQUEST_TOO_LARGE" : "INVALID_REFUND_REQUEST" },
      { status: read.error === "BODY_TOO_LARGE" ? 413 : 400 },
    );
  }
  const parsed = RefundSchema.safeParse(read.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_REFUND_REQUEST" }, { status: 400 });
  }

  const existing = await prisma.refund.findUnique({
    where: { idempotencyKey: parsed.data.idempotencyKey },
  });
  if (existing) {
    if (existing.orderId !== parsed.data.orderId || existing.amountCents !== parsed.data.amountCents) {
      return NextResponse.json({ error: "REFUND_KEY_CONFLICT" }, { status: 409 });
    }
    return NextResponse.json({
      refundId: existing.providerRefundId,
      status: existing.status,
      amountCents: existing.amountCents,
      duplicate: true,
    });
  }

  const order = await prisma.order.findUnique({
    where: { id: parsed.data.orderId },
    include: {
      payments: true,
      refunds: true,
      procurementIntents: {
        include: {
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
      },
    },
  });
  if (!order) return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  if (!order.stripePaymentIntentId || !["paid", "partially_refunded"].includes(order.status)) {
    return NextResponse.json({ error: "ORDER_NOT_REFUNDABLE" }, { status: 409 });
  }

  const interlock = evaluateRefundProcurementInterlock(order.procurementIntents);
  let postPurchase:
    | { ok: true; allocations: Array<{ procurementIntentId: string; refundAmountCents: number }> }
    | null = null;

  if (!interlock.ok) {
    if (interlock.reason !== "REFUND_BLOCKED_AFTER_SUPPLIER_PURCHASE") {
      return NextResponse.json(
        { error: interlock.reason, blockedProcurementIntentIds: interlock.intentIds },
        { status: 409 },
      );
    }

    const mixedSpendableState = order.procurementIntents.some((intent) =>
      ["awaiting_review", "approved_manual", "hold"].includes(intent.status),
    );
    if (mixedSpendableState) {
      return NextResponse.json({ error: "POST_PURCHASE_REFUND_MIXED_STATE_UNSUPPORTED" }, { status: 409 });
    }

    const authorization = validatePostPurchaseRefund({
      intents: order.procurementIntents,
      blockingIntentIds: interlock.intentIds,
      idempotencyKey: parsed.data.idempotencyKey,
      amountCents: parsed.data.amountCents,
      allocations: parsed.data.postPurchaseAllocations,
    });
    if (!authorization.ok) {
      return NextResponse.json({ error: authorization.reason }, { status: 409 });
    }
    postPurchase = authorization;
  } else if (parsed.data.postPurchaseAllocations) {
    return NextResponse.json({ error: "POST_PURCHASE_REFUND_ALLOCATION_NOT_APPLICABLE" }, { status: 409 });
  }

  const payment = order.payments.find(
    (candidate) =>
      candidate.providerPaymentId === order.stripePaymentIntentId && candidate.status === "succeeded",
  );
  if (!payment) {
    return NextResponse.json({ error: "SUCCEEDED_PAYMENT_NOT_FOUND" }, { status: 409 });
  }

  const alreadyRefunded = order.refunds
    .filter((refund) => ["pending", "succeeded"].includes(refund.status))
    .reduce((sum, refund) => sum + refund.amountCents, 0);
  const remaining = order.totalCents - alreadyRefunded;
  if (parsed.data.amountCents > remaining) {
    return NextResponse.json(
      { error: "REFUND_EXCEEDS_REMAINING_AMOUNT", remainingCents: remaining },
      { status: 409 },
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      const currentOrder = await tx.order.findUnique({
        where: { id: order.id },
        include: {
          refunds: true,
          procurementIntents: {
            include: {
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
          },
        },
      });
      if (!currentOrder || !["paid", "partially_refunded"].includes(currentOrder.status)) {
        throw new Error("REFUND_FINANCIAL_STATE_CHANGED");
      }
      const currentAlreadyRefunded = currentOrder.refunds
        .filter((refund) => ["pending", "succeeded"].includes(refund.status))
        .reduce((sum, refund) => sum + refund.amountCents, 0);
      if (parsed.data.amountCents > currentOrder.totalCents - currentAlreadyRefunded) {
        throw new Error("REFUND_AMOUNT_CHANGED");
      }

      const currentInterlock = evaluateRefundProcurementInterlock(currentOrder.procurementIntents);
      if (postPurchase) {
        if (
          currentInterlock.ok ||
          currentInterlock.reason !== "REFUND_BLOCKED_AFTER_SUPPLIER_PURCHASE"
        ) {
          throw new Error("POST_PURCHASE_REFUND_STATE_CHANGED");
        }
        const mixedSpendableState = currentOrder.procurementIntents.some((intent) =>
          ["awaiting_review", "approved_manual", "hold"].includes(intent.status),
        );
        if (mixedSpendableState) throw new Error("POST_PURCHASE_REFUND_MIXED_STATE_UNSUPPORTED");
        const authorization = validatePostPurchaseRefund({
          intents: currentOrder.procurementIntents,
          blockingIntentIds: currentInterlock.intentIds,
          idempotencyKey: parsed.data.idempotencyKey,
          amountCents: parsed.data.amountCents,
          allocations: parsed.data.postPurchaseAllocations,
        });
        if (!authorization.ok) throw new Error(authorization.reason);
        return;
      }

      if (!currentInterlock.ok) throw new Error(currentInterlock.reason);
      for (const intentId of currentInterlock.holdIntentIds) {
        const current = currentOrder.procurementIntents.find((intent) => intent.id === intentId);
        if (!current) throw new Error("REFUND_PROCUREMENT_STATE_CHANGED");
        const updated = await tx.procurementIntent.updateMany({
          where: { id: intentId, status: current.status, updatedAt: current.updatedAt },
          data: { status: "hold" },
        });
        if (updated.count !== 1) throw new Error("REFUND_PROCUREMENT_CONCURRENT_CHANGE");
        await tx.procurementEvent.upsert({
          where: { eventKey: refundInterlockEventKey(intentId, parsed.data.idempotencyKey) },
          create: {
            eventKey: refundInterlockEventKey(intentId, parsed.data.idempotencyKey),
            procurementIntentId: intentId,
            type: "REFUND_INTERLOCK_HOLD",
            actor: `admin:${admin.id}`,
            detail: JSON.stringify({
              refundIdempotencyKey: parsed.data.idempotencyKey,
              amountCents: parsed.data.amountCents,
              previousStatus: current.status,
              nextStatus: "hold",
              reason: parsed.data.reason || null,
            }),
          },
          update: {},
        });
      }
    });

    const stripeRefund = await createStripeRefund({
      orderId: order.id,
      orderNumber: order.orderNumber,
      paymentIntentId: order.stripePaymentIntentId,
      amountCents: parsed.data.amountCents,
      reason: parsed.data.reason,
      idempotencyKey: `dealforge-refund:${parsed.data.idempotencyKey}`,
    });

    if (!stripeRefund.id) throw new Error("STRIPE_REFUND_ID_MISSING");
    if (
      stripeRefund.amount !== parsed.data.amountCents ||
      stripeRefund.currency.toLowerCase() !== order.currency.toLowerCase()
    ) {
      throw new Error("STRIPE_REFUND_RESPONSE_MISMATCH");
    }

    const refund = await prisma.$transaction(async (tx) => {
      const created = await tx.refund.create({
        data: {
          orderId: order.id,
          paymentId: payment.id,
          providerRefundId: stripeRefund.id,
          idempotencyKey: parsed.data.idempotencyKey,
          amountCents: stripeRefund.amount,
          currency: stripeRefund.currency.toLowerCase(),
          status: stripeRefund.status || "pending",
          reason: parsed.data.reason,
          requestedBy: admin.email,
        },
      });

      if (postPurchase) {
        for (const allocation of postPurchase.allocations) {
          await tx.procurementEvent.upsert({
            where: {
              eventKey: postPurchaseRefundExecutionEventKey(
                allocation.procurementIntentId,
                parsed.data.idempotencyKey,
              ),
            },
            create: {
              eventKey: postPurchaseRefundExecutionEventKey(
                allocation.procurementIntentId,
                parsed.data.idempotencyKey,
              ),
              procurementIntentId: allocation.procurementIntentId,
              type: "POST_PURCHASE_REFUND_EXECUTED",
              actor: `admin:${admin.id}`,
              detail: JSON.stringify({
                version: 1,
                refundIdempotencyKey: parsed.data.idempotencyKey,
                providerRefundId: stripeRefund.id,
                refundAmountCents: allocation.refundAmountCents,
                providerStatus: stripeRefund.status || "pending",
              }),
            },
            update: {},
          });
        }
      }

      return created;
    });

    return NextResponse.json(
      {
        refundId: refund.providerRefundId,
        status: refund.status,
        amountCents: refund.amountCents,
        procurementInterlock: postPurchase ? "post_purchase_clearance" : "hold",
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (
      message.startsWith("REFUND_") ||
      message.startsWith("POST_PURCHASE_") ||
      message === "REFUND_BLOCKED_AFTER_SUPPLIER_PURCHASE" ||
      message === "REFUND_PROCUREMENT_STATE_UNSAFE"
    ) {
      return NextResponse.json({ error: "REFUND_STATE_CONFLICT" }, { status: 409 });
    }
    console.error("refund.create.failed", { orderId: order.id, error: message });
    return NextResponse.json({ error: "REFUND_UNAVAILABLE" }, { status: 502 });
  }
}
