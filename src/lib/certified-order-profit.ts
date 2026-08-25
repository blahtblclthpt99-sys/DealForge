import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { analyzeOrderProfit } from "@/lib/profit-analytics";

type RefundFinancialDbRow = {
  refundId: string;
  kind: string;
  amountCents: number;
  feeCents: number;
  netCents: number;
  currency: string;
  transactionType: string;
  balanceTransactionId: string;
};

export async function loadCertifiedOrderProfit(orderId: string) {
  const id = orderId.trim();
  if (!id || id.length > 128) throw new Error("ORDER_ID_INVALID");

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      currency: true,
      subtotalCents: true,
      shippingCents: true,
      taxCents: true,
      totalCents: true,
      paidAt: true,
      payments: {
        select: { status: true, amountCents: true, currency: true, meta: true },
      },
      refunds: {
        select: {
          id: true,
          idempotencyKey: true,
          status: true,
          amountCents: true,
          currency: true,
        },
      },
      items: {
        select: {
          id: true,
          lineTotalCents: true,
          procurementIntent: {
            select: {
              expectedTotalCostCents: true,
              actualTotalCostCents: true,
              quantity: true,
              events: {
                orderBy: { createdAt: "asc" },
                take: 250,
                select: { type: true, detail: true, createdAt: true },
              },
            },
          },
        },
      },
    },
  });
  if (!order) return null;

  const refundIds = order.refunds.map((refund) => refund.id);
  const refundFinancialRows = refundIds.length
    ? await prisma.$queryRaw<RefundFinancialDbRow[]>(Prisma.sql`
        SELECT
          "refundId", "kind", "amountCents", "feeCents", "netCents", "currency",
          "transactionType", "providerBalanceTransactionId" AS "balanceTransactionId"
        FROM "RefundFinancialEvent"
        WHERE "refundId" IN (${Prisma.join(refundIds)})
        ORDER BY "createdAt" ASC
      `)
    : [];
  const financialByRefund = new Map<string, RefundFinancialDbRow[]>();
  for (const row of refundFinancialRows) {
    const current = financialByRefund.get(row.refundId) || [];
    current.push(row);
    financialByRefund.set(row.refundId, current);
  }

  const profit = analyzeOrderProfit({
    subtotalCents: order.subtotalCents,
    shippingCents: order.shippingCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
    currency: order.currency,
    refunds: order.refunds.map((refund) => ({
      idempotencyKey: refund.idempotencyKey,
      status: refund.status,
      amountCents: refund.amountCents,
      currency: refund.currency,
      financialEvents: financialByRefund.get(refund.id) || [],
    })),
    payments: order.payments,
    items: order.items.map((item) => ({
      id: item.id,
      lineTotalCents: item.lineTotalCents,
      procurementIntent: item.procurementIntent
        ? {
            expectedTotalCostCents: item.procurementIntent.expectedTotalCostCents,
            actualTotalCostCents: item.procurementIntent.actualTotalCostCents,
            quantity: item.procurementIntent.quantity,
            events: item.procurementIntent.events,
          }
        : null,
    })),
  });

  return {
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      currency: order.currency.toLowerCase(),
      paidAt: order.paidAt,
      totalCents: order.totalCents,
    },
    profit,
  };
}
