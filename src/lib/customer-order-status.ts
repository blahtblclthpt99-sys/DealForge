import { prisma } from "@/lib/db";
import { fulfillmentLogSource, stateFromFulfillmentMeta, type FulfillmentState } from "@/lib/order-fulfillment";
import { verifyOrderAccessToken } from "@/lib/order-access";
import { parseJson } from "@/lib/utils";

export type CustomerFinancialState =
  | "payment_pending"
  | "payment_failed"
  | "paid"
  | "partially_refunded"
  | "refunded"
  | "canceled"
  | "processing";

export type CustomerOrderStatus = {
  orderNumber: string;
  financialState: CustomerFinancialState;
  fulfillmentState: FulfillmentState | null;
  currency: string;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  refundedCents: number;
  createdAt: string;
  paidAt: string | null;
  lastUpdatedAt: string;
  items: Array<{
    title: string;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
  }>;
  tracking: {
    carrier: string;
    trackingNumber: string;
  } | null;
};

function customerFinancialState(status: string): CustomerFinancialState {
  switch (status) {
    case "pending_payment":
      return "payment_pending";
    case "payment_failed":
      return "payment_failed";
    case "paid":
      return "paid";
    case "partially_refunded":
      return "partially_refunded";
    case "refunded":
      return "refunded";
    case "canceled":
      return "canceled";
    default:
      return "processing";
  }
}

function publicTracking(logs: Array<{ message: string; meta: string }>, current: FulfillmentState | null) {
  if (current !== "shipped" && current !== "delivered") return null;
  const shipped = logs.find((log) => log.message === "MARK_SHIPPED");
  if (!shipped) return null;
  const meta = parseJson<Record<string, unknown>>(shipped.meta, {});
  const carrier = typeof meta.carrier === "string" ? meta.carrier.trim() : "";
  const trackingNumber = typeof meta.trackingNumber === "string" ? meta.trackingNumber.trim() : "";
  if (!carrier || !trackingNumber) return null;
  return { carrier, trackingNumber };
}

export async function loadCustomerOrderStatus(input: {
  orderNumber: string;
  accessToken?: string | null;
  sessionUserId?: string | null;
}): Promise<CustomerOrderStatus | null> {
  const order = await prisma.order.findUnique({
    where: { orderNumber: input.orderNumber },
    include: {
      items: true,
      refunds: { where: { status: "succeeded" } },
    },
  });
  if (!order) return null;

  const signedAccess = input.accessToken
    ? verifyOrderAccessToken(
        { id: order.id, orderNumber: order.orderNumber, createdAt: order.createdAt },
        input.accessToken,
      )
    : false;
  const accountAccess = Boolean(input.sessionUserId && order.userId === input.sessionUserId);
  if (!signedAccess && !accountAccess) return null;

  const logs = await prisma.systemLog.findMany({
    where: { source: fulfillmentLogSource(order.id) },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { message: true, meta: true, createdAt: true },
  });
  const latestLog = logs[0] || null;
  const latestMeta = latestLog ? parseJson<Record<string, unknown>>(latestLog.meta, {}) : {};
  const derivedState = stateFromFulfillmentMeta(latestMeta);
  const fulfillmentState = derivedState || (order.status === "paid" ? "awaiting_sourcing" : null);
  const refundedCents = order.refunds.reduce((sum, refund) => sum + refund.amountCents, 0);

  return {
    orderNumber: order.orderNumber,
    financialState: customerFinancialState(order.status),
    fulfillmentState,
    currency: order.currency.toLowerCase(),
    subtotalCents: order.subtotalCents,
    shippingCents: order.shippingCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
    refundedCents,
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    lastUpdatedAt: (latestLog?.createdAt || order.updatedAt).toISOString(),
    items: order.items.map((item) => ({
      title: item.title,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      lineTotalCents: item.lineTotalCents,
    })),
    tracking: publicTracking(logs, fulfillmentState),
  };
}
