import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  evaluateRefundProcurementInterlock,
  postPurchaseRefundExceptionEventKey,
  refundInterlockEventKey,
} from "@/lib/refund-procurement-interlock";
import { createStripeRefund } from "@/lib/stripe-commerce";
import { readLimitedJson } from "@/lib/request-json";
import {
  isSameOriginRefundMutation,
  requireRefundOwner,
} from "@/lib/refund-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REFUND_REQUEST_BYTES = 16 * 1024;

const PostPurchaseExceptionSchema = z.object({
  acknowledgeIrreversibleFulfillment: z.literal(true),
  recoveryPlan: z.enum([
    "supplier_cancel_requested",
    "supplier_return_required",
    "customer_return_required",
    "customer_keep_accept_loss",
  ]),
  acceptUnrecoveredLoss: z.boolean().optional(),
  note: z.string().trim().min(8).max(500),
});

const RefundSchema = z.object({
  orderId: z.string().trim().min(1).max(128),
  amountCents: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(12).max(128).regex(/^[A-Za-z0-9:_-]+$/),
  reason: z.enum(["duplicate", "fraudulent", "requested_by_customer"]).optional(),
  postPurchaseException: PostPurchaseExceptionSchema.optional(),
}).strict();

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function POST(request: Request) {
  let owner;
  try {
    owner = await requireRefundOwner();
  } catch (error) {
    const status = error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 403;
    return noStore(
      NextResponse.json({ error: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" }, { status }),
    );
  }

  if (!isSameOriginRefundMutation(request)) {
    return noStore(NextResponse.json({ error: "INVALID_ORIGIN" }, { status: 403 }));
  }

  const read = await readLimitedJson(request, MAX_REFUND_REQUEST_BYTES);
  if (!read.ok) {
    return noStore(
      NextResponse.json(
        { error: read.error === "BODY_TOO_LARGE" ? "REFUND_REQUEST_TOO_LARGE" : "INVALID_REFUND_REQUEST" },
        { status: read.error === "BODY_TOO_LARGE" ? 413 : 400 },
      ),
    );
  }

  const parsed = RefundSchema.safeParse(read.value);
  if (!parsed.success) {
    return noStore(
      NextResponse.json(
        { error: "INVALID_REFUND_REQUEST", details: parsed.error.flatten() },
        { status: 400 },
      ),
    );
  }

  const existing = await prisma.refund.findUnique({
    where: { idempotencyKey: parsed.data.idempotencyKey },
  });
  if (existing) {
    if (existing.orderId !== parsed.data.orderId || existing.amountCents !== parsed.data.amountCents) {
      return noStore(NextResponse.json({ error: "REFUND_KEY_CONFLICT" }, { status: 409 }));
    }
    return noStore(
      NextResponse.json({
        refundId: existing.providerRefundId,
        status: existing.status,
        amountCents: existing.amountCents,
        duplicate: true,
      }),
    );
  }

  const order = await prisma.order.findUnique({
    where: { id: parsed.data.orderId },
    include: { payments: true, refunds: true, procurementIntents: true },
  });
  if (!order) return noStore(NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 }));
  if (!order.stripePaymentIntentId || !["paid", "partially_refunded"].includes(order.status)) {
    return noStore(NextResponse.json({ error: "ORDER_NOT_REFUNDABLE" }, { status: 409 }));
  }

  const interlock = evaluateRefundProcurementInterlock(
    order.procurementIntents,
    parsed.data.postPurchaseException,
  );
  if (!interlock.ok) {
    return noStore(
      NextResponse.json(
        { error: interlock.reason, blockedProcurementIntentIds: interlock.intentIds },
        { status: 409 },
      ),
    );
  }

  const payment = order.payments.find(
    (candidate) =>
      candidate.providerPaymentId === order.stripePaymentIntentId && candidate.status === "succeeded",
  );
  if (!payment) {
    return noStore(NextResponse.json({ error: "SUCCEEDED_PAYMENT_NOT_FOUND" }, { status: 409 }));
  }

  const alreadyRefunded = order.refunds
    .filter((refund) => ["pending", "succeeded"].includes(refund.status))
    .reduce((sum, refund) => sum + refund.amountCents, 0);
  const remaining = order.totalCents - alreadyRefunded;
  if (parsed.data.amountCents > remaining) {
    return noStore(
      NextResponse.json(
        { error: "REFUND_EXCEEDS_REMAINING_AMOUNT", remainingCents: remaining },
        { status: 409 },
      ),
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      const currentOrder = await tx.order.findUnique({
        where: { id: order.id },
        include: { refunds: true, procurementIntents: true },
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
      const currentInterlock = evaluateRefundProcurementInterlock(
        currentOrder.procurementIntents,
        parsed.data.postPurchaseException,
      );
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
            actor: `owner:${owner.id}`,
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

      for (const intentId of currentInterlock.exceptionIntentIds) {
        const current = currentOrder.procurementIntents.find((intent) => intent.id === intentId);
        if (!current || !parsed.data.postPurchaseException) {
          throw new Error("POST_PURCHASE_EXCEPTION_STATE_CHANGED");
        }
        await tx.procurementEvent.upsert({
          where: {
            eventKey: postPurchaseRefundExceptionEventKey(intentId, parsed.data.idempotencyKey),
          },
          create: {
            eventKey: postPurchaseRefundExceptionEventKey(intentId, parsed.data.idempotencyKey),
            procurementIntentId: intentId,
            type: "POST_PURCHASE_REFUND_EXCEPTION_APPROVED",
            actor: `owner:${owner.id}`,
            detail: JSON.stringify({
              refundIdempotencyKey: parsed.data.idempotencyKey,
              amountCents: parsed.data.amountCents,
              currentStatus: current.status,
              reason: parsed.data.reason || null,
              recoveryPlan: parsed.data.postPurchaseException.recoveryPlan,
              acknowledgeIrreversibleFulfillment: true,
              acceptUnrecoveredLoss: parsed.data.postPurchaseException.acceptUnrecoveredLoss === true,
              note: parsed.data.postPurchaseException.note,
              automaticSupplierPurchasingEnabled: false,
              automaticRecoveryEnabled: false,
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
    if (stripeRefund.amount !== parsed.data.amountCents) {
      throw new Error("STRIPE_REFUND_AMOUNT_MISMATCH");
    }
    if (stripeRefund.currency.toLowerCase() !== order.currency.toLowerCase()) {
      throw new Error("STRIPE_REFUND_CURRENCY_MISMATCH");
    }
    const refund = await prisma.refund.create({
      data: {
        orderId: order.id,
        paymentId: payment.id,
        providerRefundId: stripeRefund.id,
        idempotencyKey: parsed.data.idempotencyKey,
        amountCents: stripeRefund.amount,
        currency: stripeRefund.currency.toLowerCase(),
        status: stripeRefund.status || "pending",
        reason: parsed.data.reason,
        requestedBy: owner.email,
      },
    });

    return noStore(
      NextResponse.json(
        {
          refundId: refund.providerRefundId,
          status: refund.status,
          amountCents: refund.amountCents,
          procurementInterlock: interlock.exceptionIntentIds.length > 0 ? "post_purchase_exception" : "hold",
          recoveryPlan:
            interlock.exceptionIntentIds.length > 0
              ? parsed.data.postPurchaseException?.recoveryPlan || null
              : null,
        },
        { status: 201 },
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (
      message.startsWith("REFUND_") ||
      message.startsWith("POST_PURCHASE_")
    ) {
      return noStore(NextResponse.json({ error: "REFUND_STATE_CONFLICT" }, { status: 409 }));
    }
    console.error("refund.create.failed", { orderId: order.id, error: message });
    return noStore(NextResponse.json({ error: "REFUND_UNAVAILABLE" }, { status: 502 }));
  }
}
