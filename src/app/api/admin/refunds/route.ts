import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
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
  try { admin = await requireAdmin(); }
  catch (error) {
    const status = error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 403;
    return NextResponse.json({ error: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" }, { status });
  }
  const parsed = RefundSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "INVALID_REFUND_REQUEST", details: parsed.error.flatten() }, { status: 400 });
  const existing = await prisma.refund.findUnique({ where: { idempotencyKey: parsed.data.idempotencyKey } });
  if (existing) {
    if (existing.orderId !== parsed.data.orderId || existing.amountCents !== parsed.data.amountCents) return NextResponse.json({ error: "REFUND_KEY_CONFLICT" }, { status: 409 });
    return NextResponse.json({ refundId: existing.providerRefundId, status: existing.status, amountCents: existing.amountCents, duplicate: true });
  }
  const order = await prisma.order.findUnique({ where: { id: parsed.data.orderId }, include: { payments: true, refunds: true } });
  if (!order) return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  if (!order.stripePaymentIntentId || !["paid", "partially_refunded"].includes(order.status)) return NextResponse.json({ error: "ORDER_NOT_REFUNDABLE" }, { status: 409 });
  const payment = order.payments.find((candidate) => candidate.providerPaymentId === order.stripePaymentIntentId && candidate.status === "succeeded");
  if (!payment) return NextResponse.json({ error: "SUCCEEDED_PAYMENT_NOT_FOUND" }, { status: 409 });
  const alreadyRefunded = order.refunds.filter((refund) => ["pending", "succeeded"].includes(refund.status)).reduce((sum, refund) => sum + refund.amountCents, 0);
  const remaining = order.totalCents - alreadyRefunded;
  if (parsed.data.amountCents > remaining) return NextResponse.json({ error: "REFUND_EXCEEDS_REMAINING_AMOUNT", remainingCents: remaining }, { status: 409 });
  try {
    const stripeRefund = await createStripeRefund({ orderId: order.id, orderNumber: order.orderNumber, paymentIntentId: order.stripePaymentIntentId, amountCents: parsed.data.amountCents, reason: parsed.data.reason, idempotencyKey: `dealforge-refund:${parsed.data.idempotencyKey}` });
    if (!stripeRefund.id) throw new Error("STRIPE_REFUND_ID_MISSING");
    if (stripeRefund.payment_intent && stripeRefund.payment_intent !== order.stripePaymentIntentId) throw new Error("STRIPE_REFUND_PAYMENT_INTENT_MISMATCH");
    if (stripeRefund.amount !== parsed.data.amountCents) throw new Error("STRIPE_REFUND_AMOUNT_MISMATCH");
    if (stripeRefund.currency.toLowerCase() !== order.currency.toLowerCase()) throw new Error("STRIPE_REFUND_CURRENCY_MISMATCH");

    // Stripe can deliver refund.created before this request resumes. Upsert by provider
    // refund ID so webhook-first delivery and API-first delivery converge on one ledger row.
    const refund = await prisma.refund.upsert({
      where: { providerRefundId: stripeRefund.id },
      create: {
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
      update: {
        paymentId: payment.id,
        idempotencyKey: parsed.data.idempotencyKey,
        amountCents: stripeRefund.amount,
        currency: stripeRefund.currency.toLowerCase(),
        status: stripeRefund.status || "pending",
        reason: parsed.data.reason,
        requestedBy: admin.email,
      },
    });
    return NextResponse.json({ refundId: refund.providerRefundId, status: refund.status, amountCents: refund.amountCents }, { status: 201 });
  } catch (error) {
    console.error("refund.create.failed", { orderId: order.id, error: error instanceof Error ? error.message : "UNKNOWN" });
    return NextResponse.json({ error: "REFUND_UNAVAILABLE" }, { status: 502 });
  }
}
