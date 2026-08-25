import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { analyzeOrderOperations } from "@/lib/order-operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET() {
  try {
    await requireAdmin();
  } catch (error) {
    const status = error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 403;
    return noStore(
      NextResponse.json({ error: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" }, { status }),
    );
  }

  const orders = await prisma.order.findMany({
    where: { status: { in: ["paid", "partially_refunded", "refunded"] } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      orderNumber: true,
      email: true,
      status: true,
      currency: true,
      totalCents: true,
      paidAt: true,
      createdAt: true,
      updatedAt: true,
      refunds: {
        select: { status: true, amountCents: true },
      },
      items: {
        select: {
          id: true,
          title: true,
          quantity: true,
          lineTotalCents: true,
          procurementIntent: {
            select: {
              status: true,
              blockedReason: true,
              expectedTotalCostCents: true,
              actualTotalCostCents: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      },
    },
  });

  const operations = orders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    email: order.email,
    status: order.status,
    currency: order.currency,
    totalCents: order.totalCents,
    paidAt: order.paidAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    items: order.items.map((item) => ({
      id: item.id,
      title: item.title,
      quantity: item.quantity,
      lineTotalCents: item.lineTotalCents,
      fulfillmentStatus: item.procurementIntent?.status || "missing",
    })),
    ...analyzeOrderOperations({
      totalCents: order.totalCents,
      refunds: order.refunds,
      items: order.items.map((item) => ({
        id: item.id,
        lineTotalCents: item.lineTotalCents,
        procurementIntent: item.procurementIntent,
      })),
    }),
  }));

  const summary = operations.reduce(
    (acc, order) => {
      if (order.highestSeverity === "critical") acc.criticalOrders += 1;
      else if (order.highestSeverity === "warning") acc.warningOrders += 1;
      else acc.cleanOrders += 1;
      acc.retainedRevenueCents += order.financials.retainedRevenueCents;
      acc.projectedSupplierCostCents += order.financials.projectedSupplierCostCents;
      if (order.financials.fullyCostReconciled) acc.reconciledOrders += 1;
      return acc;
    },
    {
      orderCount: operations.length,
      criticalOrders: 0,
      warningOrders: 0,
      cleanOrders: 0,
      reconciledOrders: 0,
      retainedRevenueCents: 0,
      projectedSupplierCostCents: 0,
    },
  );

  return noStore(
    NextResponse.json({
      readOnly: true,
      automaticSupplierPurchasingEnabled: false,
      summary: {
        ...summary,
        projectedContributionCents:
          summary.retainedRevenueCents - summary.projectedSupplierCostCents,
      },
      orders: operations,
    }),
  );
}
