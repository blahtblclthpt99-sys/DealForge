import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  evaluateRefundProcurementInterlock,
  refundInterlockEventKey,
} from "@/lib/refund-procurement-interlock";
import { createStripeRefund } from "@/lib/stripe-commerce";

export const runtime = "nodejs";

const RefundSchema = z.object({
  orderId: z.string().trim().min(1).max(128),
  amountCents: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(12).max(128).regex(/^[A-Za-z0-9:_-]+$/),
  reason: z.enum(["duplicate", "fraudulent", "requested_by_customer"]).optional(),
});

export async function POST(request: Request) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    const status = error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 403;
    return NextResponse.json({ error: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" }, { status });
  }

  const parsed = RefundSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_REFUND_REQUEST", details: parsed.error.flatten() },
      { status: 400 },
    );
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
    include: { payments: true, refunds: true, procurementIntents: true },
  });
  if (!order) return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  if (!order.stripePaymentIntentId || !["paid", "partially_refunded"].includes(order.status)) {
    return NextResponse.json({ error: "ORDER_NOT_REFUNDABLE" }, { status: 409 });
  }

  const interlock = evaluateRefundProcurementInterlock(order.procurementIntents);
  if (!interlock.ok) {
    return NextResponse.json(
      { error: interlock.reason, blockedProcurementIntentIds: interlock.intentIds },
      { status: 409 },
    );
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
      const currentInterlock = evaluateRefundProcurementInterlock(currentOrder.procurementIntents);
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
        requestedBy: admin.email,
      },
    });

    return NextResponse.json(
      {
        refundId: refund.providerRefundId,
        status: refund.status,
        amountCents: refund.amountCents,
        procurementInterlock: "hold",
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (
      message.startsWith("REFUND_") ||
      message === "REFUND_BLOCKED_AFTER_SUPPLIER_PURCHASE" ||
      message === "REFUND_PROCUREMENT_STATE_UNSAFE"
    ) {
      return NextResponse.json({ error: "REFUND_STATE_CONFLICT" }, { status: 409 });
    }
    console.error("refund.create.failed", { orderId: order.id, error: message });
    return NextResponse.json({ error: "REFUND_UNAVAILABLE" }, { status: 502 });
  }
}
