import { prisma } from "../lib/db";
import { isFinancialGateCertified } from "../lib/financial-gate";
import { checkPendingCheckoutSafety } from "../lib/pending-checkout-safety";
import { expireStripeCheckoutSession, retrieveStripeCheckoutSession } from "../lib/stripe-commerce";

const DEFAULT_SCAN_LIMIT = 100;
const MAX_SCAN_LIMIT = 250;
const ACTIVE_SESSION_LOOKBACK_MS = 48 * 60 * 60 * 1000;

export type CheckoutSafetyMaintenanceResult = {
  scanned: number;
  safe: number;
  unsafe: number;
  revoked: number;
  alreadyClosed: number;
  completedBeforeRevocation: number;
  providerErrors: number;
  reasons: Record<string, number>;
};

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

async function logCheckoutSafety(input: {
  level: "info" | "warn" | "error";
  orderId: string;
  orderNumber: string;
  message: string;
  reason: string;
  detail?: string | null;
}) {
  try {
    await prisma.systemLog.create({
      data: {
        level: input.level,
        source: "checkout-safety",
        message: input.message,
        meta: JSON.stringify({
          orderId: input.orderId,
          orderNumber: input.orderNumber,
          reason: input.reason,
          detail: input.detail ?? null,
          automaticRefundsEnabled: false,
          automaticSupplierPurchasingEnabled: false,
        }),
      },
    });
  } catch (error) {
    console.error("checkout.safety.log_failed", {
      orderId: input.orderId,
      errorName: error instanceof Error ? error.name : "UNKNOWN",
    });
  }
}

export async function revokeUnsafePendingCheckouts(
  limit = DEFAULT_SCAN_LIMIT,
): Promise<CheckoutSafetyMaintenanceResult> {
  const safeLimit = Math.min(MAX_SCAN_LIMIT, Math.max(1, Math.trunc(limit)));
  const now = new Date();
  const orders = await prisma.order.findMany({
    where: {
      status: { in: ["pending_payment", "payment_failed"] },
      stripeCheckoutSessionId: { not: null },
      createdAt: { gte: new Date(now.getTime() - ACTIVE_SESSION_LOOKBACK_MS) },
    },
    orderBy: { createdAt: "asc" },
    take: safeLimit,
    select: {
      id: true,
      orderNumber: true,
      currency: true,
      totalCents: true,
      stripeCheckoutSessionId: true,
      items: {
        select: {
          productId: true,
          quantity: true,
          unitPriceCents: true,
          landedCostCents: true,
        },
      },
    },
  });

  const result: CheckoutSafetyMaintenanceResult = {
    scanned: orders.length,
    safe: 0,
    unsafe: 0,
    revoked: 0,
    alreadyClosed: 0,
    completedBeforeRevocation: 0,
    providerErrors: 0,
    reasons: {},
  };
  if (orders.length === 0) return result;

  const productIds = [...new Set(orders.flatMap((order) => order.items.map((item) => item.productId)))];
  const products = productIds.length
    ? await prisma.product.findMany({ where: { id: { in: productIds } } })
    : [];
  const productById = new Map(products.map((product) => [product.id, product]));
  const financialGateCertified = isFinancialGateCertified();

  for (const order of orders) {
    const orderProducts = order.items
      .map((item) => productById.get(item.productId))
      .filter((product): product is NonNullable<typeof product> => Boolean(product));
    const safety = checkPendingCheckoutSafety({
      currency: order.currency,
      totalCents: order.totalCents,
      items: order.items,
      products: orderProducts,
      financialGateCertified,
      nowMs: now.getTime(),
    });

    if (safety.safe) {
      result.safe += 1;
      continue;
    }

    result.unsafe += 1;
    const reasonKey = safety.detail ? `${safety.reason}:${safety.detail}` : safety.reason;
    result.reasons[reasonKey] = (result.reasons[reasonKey] || 0) + 1;
    const checkoutSessionId = order.stripeCheckoutSessionId;
    if (!checkoutSessionId) continue;

    try {
      const session = await retrieveStripeCheckoutSession(checkoutSessionId);
      if (!sessionMatchesOrder(session, order)) {
        result.providerErrors += 1;
        await logCheckoutSafety({
          level: "error",
          orderId: order.id,
          orderNumber: order.orderNumber,
          message: "Stripe Checkout Session identity mismatch; automatic expiration skipped",
          reason: "SESSION_MISMATCH",
          detail: safety.detail,
        });
        continue;
      }

      if (session.payment_status === "paid" || session.status === "complete") {
        result.completedBeforeRevocation += 1;
        continue;
      }
      if (session.status !== "open") {
        result.alreadyClosed += 1;
        continue;
      }

      try {
        await expireStripeCheckoutSession({
          checkoutSessionId,
          orderId: order.id,
          reason: reasonKey,
        });
      } catch (expireError) {
        // Resolve the only acceptable race: payment/expiration changed after GET.
        const latest = await retrieveStripeCheckoutSession(checkoutSessionId);
        if (!sessionMatchesOrder(latest, order)) throw expireError;
        if (latest.payment_status === "paid" || latest.status === "complete") {
          result.completedBeforeRevocation += 1;
          continue;
        }
        if (latest.status !== "expired") throw expireError;
      }

      result.revoked += 1;
      await logCheckoutSafety({
        level: "warn",
        orderId: order.id,
        orderNumber: order.orderNumber,
        message: "Unsafe unpaid Stripe Checkout Session expired",
        reason: safety.reason,
        detail: safety.detail,
      });
    } catch (error) {
      result.providerErrors += 1;
      await logCheckoutSafety({
        level: "error",
        orderId: order.id,
        orderNumber: order.orderNumber,
        message: "Unsafe unpaid Stripe Checkout Session could not be verified or expired",
        reason: safety.reason,
        detail: safety.detail,
      });
      console.error("checkout.safety.provider_failed", {
        orderId: order.id,
        errorName: error instanceof Error ? error.name : "UNKNOWN",
      });
    }
  }

  return result;
}
