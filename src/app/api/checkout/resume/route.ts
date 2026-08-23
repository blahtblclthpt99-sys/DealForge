import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isFinancialGateCertified } from "@/lib/financial-gate";
import { checkPendingCheckoutSafety } from "@/lib/pending-checkout-safety";
import { expireStripeCheckoutSession, retrieveStripeCheckoutSession } from "@/lib/stripe-commerce";

export const runtime = "nodejs";

const CHECKOUT_KEY = /^[A-Za-z0-9:_-]{8,128}$/;
const ORDER_NUMBER = /^DF-[A-Z0-9]+-[A-F0-9]{8}$/;

function appUrl(request: Request) {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  return configured || new URL(request.url).origin;
}

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function sessionMatchesOrder(
  session: Awaited<ReturnType<typeof retrieveStripeCheckoutSession>>,
  order: { id: string; orderNumber: string; stripeCheckoutSessionId: string | null },
) {
  return Boolean(
    order.stripeCheckoutSessionId
    && session.id === order.stripeCheckoutSessionId
    && session.client_reference_id === order.id
    && session.metadata?.order_id === order.id
    && session.metadata?.order_number === order.orderNumber,
  );
}

async function recordRevocation(order: { id: string; orderNumber: string }, reason: string, detail: string | null) {
  try {
    await prisma.systemLog.create({
      data: {
        level: "warn",
        source: "checkout-safety",
        message: "Unsafe unpaid Stripe Checkout Session expired",
        meta: JSON.stringify({
          orderId: order.id,
          orderNumber: order.orderNumber,
          reason,
          detail,
          automaticRefundsEnabled: false,
          automaticSupplierPurchasingEnabled: false,
        }),
      },
    });
  } catch (error) {
    console.error("checkout.resume.revocation_log_failed", {
      orderId: order.id,
      errorName: error instanceof Error ? error.name : "UNKNOWN",
    });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const orderNumber = url.searchParams.get("order")?.trim() || "";
  const checkoutKey = url.searchParams.get("key")?.trim() || "";
  if (!ORDER_NUMBER.test(orderNumber) || !CHECKOUT_KEY.test(checkoutKey)) {
    return noStore(NextResponse.json({ error: "INVALID_CHECKOUT_RESUME_REQUEST" }, { status: 400 }));
  }

  const order = await prisma.order.findUnique({
    where: { checkoutKey },
    include: { items: true },
  });
  if (!order || order.orderNumber !== orderNumber) {
    return noStore(NextResponse.json({ error: "CHECKOUT_NOT_FOUND" }, { status: 404 }));
  }

  const base = appUrl(request);
  if (["paid", "partially_refunded", "refunded"].includes(order.status)) {
    return noStore(NextResponse.redirect(`${base}/checkout/success?order=${encodeURIComponent(order.orderNumber)}`, 302));
  }
  if (!order.stripeCheckoutSessionId) {
    return noStore(NextResponse.json({ error: "CHECKOUT_SESSION_NOT_READY" }, { status: 409 }));
  }

  const productIds = [...new Set(order.items.map((item) => item.productId))];
  const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
  const checkoutSafety = checkPendingCheckoutSafety({
    currency: order.currency,
    totalCents: order.totalCents,
    items: order.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      landedCostCents: item.landedCostCents,
    })),
    products,
    financialGateCertified: isFinancialGateCertified(),
    nowMs: Date.now(),
  });

  try {
    const session = await retrieveStripeCheckoutSession(order.stripeCheckoutSessionId);
    if (!sessionMatchesOrder(session, order)) {
      return noStore(NextResponse.json({ error: "CHECKOUT_SESSION_MISMATCH" }, { status: 409 }));
    }
    if (session.payment_status === "paid" || session.status === "complete") {
      return noStore(NextResponse.redirect(`${base}/checkout/success?order=${encodeURIComponent(order.orderNumber)}`, 302));
    }
    if (session.status !== "open" || !session.url) {
      return noStore(NextResponse.json({ error: "CHECKOUT_SESSION_NOT_OPEN" }, { status: 409 }));
    }

    if (!checkoutSafety.safe) {
      try {
        await expireStripeCheckoutSession({
          checkoutSessionId: session.id,
          orderId: order.id,
          reason: `${checkoutSafety.reason}:${checkoutSafety.detail || "none"}`,
        });
      } catch (expireError) {
        // A customer may complete payment between our GET and expire POST. Re-read
        // Stripe before deciding whether the revocation truly failed.
        const latest = await retrieveStripeCheckoutSession(order.stripeCheckoutSessionId);
        if (!sessionMatchesOrder(latest, order)) {
          return noStore(NextResponse.json({ error: "CHECKOUT_SESSION_MISMATCH" }, { status: 409 }));
        }
        if (latest.payment_status === "paid" || latest.status === "complete") {
          return noStore(NextResponse.redirect(`${base}/checkout/success?order=${encodeURIComponent(order.orderNumber)}`, 302));
        }
        if (latest.status !== "expired") throw expireError;
      }

      await recordRevocation(order, checkoutSafety.reason, checkoutSafety.detail);
      return noStore(NextResponse.json({ error: "CHECKOUT_REVALIDATION_REQUIRED" }, { status: 409 }));
    }

    return noStore(NextResponse.redirect(session.url, 302));
  } catch (error) {
    console.error("checkout.resume.failed", { orderId: order.id, errorName: error instanceof Error ? error.name : "UNKNOWN" });
    return noStore(NextResponse.json({ error: "CHECKOUT_RESUME_UNAVAILABLE" }, { status: 502 }));
  }
}
