import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { retrieveStripeCheckoutSession } from "@/lib/stripe-commerce";

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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const orderNumber = url.searchParams.get("order")?.trim() || "";
  const checkoutKey = url.searchParams.get("key")?.trim() || "";
  if (!ORDER_NUMBER.test(orderNumber) || !CHECKOUT_KEY.test(checkoutKey)) {
    return noStore(NextResponse.json({ error: "INVALID_CHECKOUT_RESUME_REQUEST" }, { status: 400 }));
  }

  const order = await prisma.order.findUnique({ where: { checkoutKey } });
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

  try {
    const session = await retrieveStripeCheckoutSession(order.stripeCheckoutSessionId);
    if (session.id !== order.stripeCheckoutSessionId || session.client_reference_id !== order.id || session.metadata?.order_id !== order.id || session.metadata?.order_number !== order.orderNumber) {
      return noStore(NextResponse.json({ error: "CHECKOUT_SESSION_MISMATCH" }, { status: 409 }));
    }
    if (session.payment_status === "paid" || session.status === "complete") {
      return noStore(NextResponse.redirect(`${base}/checkout/success?order=${encodeURIComponent(order.orderNumber)}`, 302));
    }
    if (session.status !== "open" || !session.url) {
      return noStore(NextResponse.json({ error: "CHECKOUT_SESSION_NOT_OPEN" }, { status: 409 }));
    }

    return noStore(NextResponse.redirect(session.url, 302));
  } catch (error) {
    console.error("checkout.resume.failed", { orderId: order.id, errorName: error instanceof Error ? error.name : "UNKNOWN" });
    return noStore(NextResponse.json({ error: "CHECKOUT_RESUME_UNAVAILABLE" }, { status: 502 }));
  }
}
