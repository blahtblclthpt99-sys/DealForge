import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  fulfillmentLogSource,
  stateFromFulfillmentMeta,
  type FulfillmentState,
} from "@/lib/order-fulfillment";
import { evaluateOrderOperationsHealth } from "@/lib/order-operations-health";
import { isProductOwner } from "@/lib/owner-access";
import { parseJson } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function currentOwner() {
  const session = await readSession();
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, email: true, role: true },
  });
  if (!user || !(await isProductOwner(user))) return null;
  return user;
}

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: Request) {
  const owner = await currentOwner();
  if (!owner) return noStore(NextResponse.json({ error: "Forbidden" }, { status: 403 }));

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const mode = url.searchParams.get("mode") === "history" ? "history" : "actionable";

  const orders = await prisma.order.findMany({
    where: {
      ...(mode === "actionable"
        ? { status: "paid" }
        : { status: { in: ["paid", "partially_refunded", "refunded"] } }),
      ...(q
        ? {
            OR: [
              { orderNumber: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 40,
    include: {
      items: true,
      payments: {
        where: { status: "succeeded" },
        orderBy: { createdAt: "desc" },
      },
      refunds: {
        where: { status: "succeeded" },
      },
    },
  });

  const sources = orders.map((order) => fulfillmentLogSource(order.id));
  const logs = sources.length
    ? await prisma.systemLog.findMany({
        where: { source: { in: sources } },
        orderBy: { createdAt: "desc" },
        take: 1_000,
      })
    : [];

  const latest = new Map<string, (typeof logs)[number]>();
  for (const log of logs) {
    if (!latest.has(log.source)) latest.set(log.source, log);
  }

  const nowMs = Date.now();
  const items = orders.map((order) => {
    const log = latest.get(fulfillmentLogSource(order.id));
    const logMeta = log ? parseJson<Record<string, unknown>>(log.meta, {}) : {};
    const fulfillmentState: FulfillmentState | null =
      stateFromFulfillmentMeta(logMeta) || (order.status === "paid" ? "awaiting_sourcing" : null);
    const stateEnteredAtMs = fulfillmentState === "awaiting_sourcing"
      ? order.paidAt?.getTime() ?? null
      : log?.createdAt.getTime() ?? null;
    const operationsHealth = evaluateOrderOperationsHealth({
      financialStatus: order.status,
      fulfillmentState,
      paidAtMs: order.paidAt?.getTime() ?? null,
      stateEnteredAtMs,
      nowMs,
    });
    const refundedCents = order.refunds.reduce((sum, refund) => sum + refund.amountCents, 0);
    const succeededPayment = order.payments.find(
      (payment) =>
        payment.providerPaymentId === order.stripePaymentIntentId &&
        payment.amountCents === order.totalCents &&
        payment.currency.toLowerCase() === order.currency.toLowerCase(),
    );

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      email: order.email,
      financialStatus: order.status,
      currency: order.currency,
      totalCents: order.totalCents,
      refundedCents,
      paidAt: order.paidAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      paymentCertified: Boolean(succeededPayment && order.paidAt && order.stripePaymentIntentId),
      fulfillmentState,
      operationsHealth,
      lastFulfillmentAction: log?.message ?? null,
      lastFulfillmentAt: log?.createdAt.toISOString() ?? null,
      fulfillmentDetail: logMeta,
      orderItems: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productSlug: item.productSlug,
        title: item.title,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        lineTotalCents: item.lineTotalCents,
        landedCostCents: item.landedCostCents,
      })),
    };
  });

  return noStore(NextResponse.json({ ok: true, mode, items }));
}
