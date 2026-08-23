import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  estimatedOrderLandedCostCents,
  fulfillmentLogSource,
  stateFromFulfillmentMeta,
} from "@/lib/order-fulfillment";
import {
  actualSupplierCostFromFulfillmentLogs,
  calculateOrderProfitability,
  rollupOrderProfitability,
} from "@/lib/order-profitability";
import { isProductOwner } from "@/lib/owner-access";
import { parseJson } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_PERIOD_DAYS = new Set([30, 90, 365]);
const MAX_ORDERS = 250;

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

function periodDaysFromRequest(request: Request) {
  const raw = Number(new URL(request.url).searchParams.get("days") || "90");
  return Number.isInteger(raw) && ALLOWED_PERIOD_DAYS.has(raw) ? raw : 90;
}

export async function GET(request: Request) {
  const owner = await currentOwner();
  if (!owner) return noStore(NextResponse.json({ error: "Forbidden" }, { status: 403 }));

  const periodDays = periodDaysFromRequest(request);
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: since },
      status: { in: ["paid", "partially_refunded", "refunded"] },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_ORDERS,
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
        take: 5_000,
      })
    : [];

  const logsBySource = new Map<string, typeof logs>();
  for (const log of logs) {
    const group = logsBySource.get(log.source) || [];
    group.push(log);
    logsBySource.set(log.source, group);
  }

  const rows = orders.map((order) => {
    const source = fulfillmentLogSource(order.id);
    const orderLogs = logsBySource.get(source) || [];
    const latestLog = orderLogs[0];
    const latestMeta = latestLog ? parseJson<Record<string, unknown>>(latestLog.meta, {}) : {};
    const fulfillmentState = stateFromFulfillmentMeta(latestMeta)
      || (order.status === "paid" ? "awaiting_sourcing" : null);
    const refundedCents = order.refunds.reduce((sum, refund) => sum + refund.amountCents, 0);
    const paymentCertified = Boolean(
      order.paidAt
      && order.stripePaymentIntentId
      && order.payments.some(
        (payment) =>
          payment.providerPaymentId === order.stripePaymentIntentId
          && payment.amountCents === order.totalCents
          && payment.currency.toLowerCase() === order.currency.toLowerCase(),
      ),
    );
    const estimatedSupplierCostCents = estimatedOrderLandedCostCents(order.items);
    const actualSupplierCostCents = actualSupplierCostFromFulfillmentLogs(
      orderLogs.map((log) => ({ message: log.message, meta: log.meta })),
    );
    const profitability = calculateOrderProfitability({
      currency: order.currency,
      totalCents: order.totalCents,
      refundedCents,
      paymentCertified,
      estimatedSupplierCostCents,
      actualSupplierCostCents,
    });

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      financialStatus: order.status,
      fulfillmentState,
      createdAt: order.createdAt.toISOString(),
      paidAt: order.paidAt?.toISOString() ?? null,
      ...profitability,
    };
  });

  const summary = rollupOrderProfitability(rows);
  return noStore(NextResponse.json({
    ok: true,
    periodDays,
    limitedToMostRecentOrders: MAX_ORDERS,
    accountingBasis: "REALIZED_CONTRIBUTION_BEFORE_PROCESSOR_FEES_AND_OVERHEAD",
    summary,
    orders: rows,
  }));
}
