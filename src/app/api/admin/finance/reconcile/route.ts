import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { retrieveStripePaymentIntent } from "@/lib/stripe-commerce";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch (error) {
    const status = error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 403;
    return NextResponse.json({ error: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" }, { status });
  }

  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId")?.trim();
  const orderNumber = url.searchParams.get("orderNumber")?.trim();
  if (!orderId && !orderNumber) {
    return NextResponse.json({ error: "ORDER_IDENTIFIER_REQUIRED" }, { status: 400 });
  }

  const order = await prisma.order.findFirst({
    where: orderId ? { id: orderId } : { orderNumber },
    include: { payments: true, refunds: true },
  });
  if (!order) return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  if (!order.stripePaymentIntentId) {
    return NextResponse.json(
      {
        reconciled: false,
        orderNumber: order.orderNumber,
        reason: "NO_STRIPE_PAYMENT_INTENT",
        localStatus: order.status,
      },
      { status: 409 },
    );
  }

  try {
    const stripe = await retrieveStripePaymentIntent(order.stripePaymentIntentId);
    const charge =
      stripe.latest_charge && typeof stripe.latest_charge === "object" ? stripe.latest_charge : null;
    const stripeRefundedCents = charge?.amount_refunded || 0;
    const ledgerRefundedCents = order.refunds
      .filter((refund) => refund.status === "succeeded")
      .reduce((sum, refund) => sum + refund.amountCents, 0);
    const localPayment = order.payments.find(
      (payment) => payment.providerPaymentId === order.stripePaymentIntentId,
    );

    const checks = {
      paymentIntentId: stripe.id === order.stripePaymentIntentId,
      currency: stripe.currency.toLowerCase() === order.currency.toLowerCase(),
      amount: stripe.amount === order.totalCents,
      paymentStatus:
        stripe.status === "succeeded"
          ? order.status === "paid" || order.status === "partially_refunded" || order.status === "refunded"
          : localPayment?.status === stripe.status,
      paymentLedger: stripe.status !== "succeeded" || localPayment?.status === "succeeded",
      refunds: stripeRefundedCents === ledgerRefundedCents,
    };
    const mismatches = Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name);

    return NextResponse.json({
      reconciled: mismatches.length === 0,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        totalCents: order.totalCents,
        currency: order.currency,
        paymentIntentId: order.stripePaymentIntentId,
        succeededRefundCents: ledgerRefundedCents,
      },
      stripe: {
        paymentIntentId: stripe.id,
        status: stripe.status,
        amountCents: stripe.amount,
        amountReceivedCents: stripe.amount_received || 0,
        currency: stripe.currency,
        refundedCents: stripeRefundedCents,
      },
      checks,
      mismatches,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    console.error("finance.reconcile.failed", { orderId: order.id, error: message });
    return NextResponse.json({ error: "STRIPE_RECONCILIATION_UNAVAILABLE" }, { status: 502 });
  }
}
