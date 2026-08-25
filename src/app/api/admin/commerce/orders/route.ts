import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { analyzeOrderOperations } from "@/lib/order-operations";
import { analyzeOrderProfit } from "@/lib/profit-analytics";

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
      subtotalCents: true,
      shippingCents: true,
      taxCents: true,
      totalCents: true,
      paidAt: true,
      createdAt: true,
      updatedAt: true,
      payments: {
        select: {
          status: true,
          amountCents: true,
          currency: true,
          meta: true,
        },
      },
      refunds: {
        select: {
          idempotencyKey: true,
          status: true,
          amountCents: true,
          currency: true,
        },
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
              quantity: true,
              createdAt: true,
              updatedAt: true,
              events: {
                orderBy: { createdAt: "asc" },
                take: 250,
                select: {
                  type: true,
                  detail: true,
                  createdAt: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const operations = orders.map((order) => {
    const operational = analyzeOrderOperations({
      totalCents: order.totalCents,
      refunds: order.refunds,
      items: order.items.map((item) => ({
        id: item.id,
        lineTotalCents: item.lineTotalCents,
        procurementIntent: item.procurementIntent,
      })),
    });
    const profit = analyzeOrderProfit({
      subtotalCents: order.subtotalCents,
      shippingCents: order.shippingCents,
      taxCents: order.taxCents,
      totalCents: order.totalCents,
      currency: order.currency,
      refunds: order.refunds,
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
      ...operational,
      profit,
    };
  });

  const summary = operations.reduce(
    (acc, order) => {
      if (order.highestSeverity === "critical") acc.criticalOrders += 1;
      else if (order.highestSeverity === "warning") acc.warningOrders += 1;
      else acc.cleanOrders += 1;

      acc.grossCustomerReceiptsCents += order.profit.receipts.grossCustomerReceiptsCents;
      acc.succeededRefundCents += order.profit.receipts.succeededRefundCents;
      acc.pendingRefundCents += order.profit.receipts.pendingRefundCents;
      acc.netCustomerReceiptsCents += order.profit.receipts.netCustomerReceiptsCents;
      acc.knownActualSupplierCostCents += order.profit.supplier.knownActualSupplierCostCents;
      acc.supplierRecoveredCents += order.profit.supplier.supplierRecoveredCents;
      acc.netKnownSupplierCostCents += order.profit.supplier.netKnownSupplierCostCents;
      acc.acceptedLossCents += order.profit.supplier.acceptedLossCents;
      acc.remainingRecoveryExposureCents += order.profit.supplier.remainingRecoveryExposureCents;
      acc.knownPaymentProcessingFeeCents += order.profit.paymentProcessing.knownFeeCents;
      acc.contributionBeforeTaxAndPaymentFeesCents +=
        order.profit.contribution.contributionBeforeTaxAndPaymentFeesCents;
      acc.openRecoveryCaseCount += order.profit.recovery.openRecoveryCaseCount;

      if (order.financials.fullyCostReconciled) acc.reconciledOrders += 1;
      if (order.profit.contribution.certified) {
        acc.certifiedContributionOrderCount += 1;
        acc.certifiedOrderContributionCents +=
          order.profit.contribution.certifiedOrderContributionCents || 0;
        if ((order.profit.contribution.certifiedOrderContributionCents || 0) <= 0) {
          acc.certifiedLossOrderCount += 1;
        }
      } else {
        acc.incompleteContributionOrderCount += 1;
      }
      return acc;
    },
    {
      orderCount: operations.length,
      criticalOrders: 0,
      warningOrders: 0,
      cleanOrders: 0,
      reconciledOrders: 0,
      certifiedContributionOrderCount: 0,
      incompleteContributionOrderCount: 0,
      certifiedLossOrderCount: 0,
      grossCustomerReceiptsCents: 0,
      succeededRefundCents: 0,
      pendingRefundCents: 0,
      netCustomerReceiptsCents: 0,
      knownActualSupplierCostCents: 0,
      supplierRecoveredCents: 0,
      netKnownSupplierCostCents: 0,
      acceptedLossCents: 0,
      remainingRecoveryExposureCents: 0,
      knownPaymentProcessingFeeCents: 0,
      contributionBeforeTaxAndPaymentFeesCents: 0,
      certifiedOrderContributionCents: 0,
      openRecoveryCaseCount: 0,
    },
  );

  return noStore(
    NextResponse.json({
      readOnly: true,
      automaticSupplierPurchasingEnabled: false,
      automaticRecoveryEnabled: false,
      profitMetric: {
        name: "order_contribution",
        certifiedRequires: [
          "actual supplier costs",
          "authoritative payment processing fees",
          "known tax liability",
          "no pending refunds",
          "closed valid recovery cases",
        ],
        note: "Accepted unrecovered loss is disclosure of supplier cost not recovered and is never subtracted twice.",
      },
      summary,
      orders: operations,
    }),
  );
}
