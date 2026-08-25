import { Prisma } from "@prisma/client";
import {
  MAX_MONTHLY_LOSS_RESERVE_BPS,
  currentCartPricingPolicy,
  type CartPricingPolicy,
} from "@/lib/cart-pricing";
import { prisma } from "@/lib/db";
import { analyzeOrderProfit } from "@/lib/profit-analytics";

export const AUTOMATIC_LOSS_RESERVE_VERSION = "trailing-30d-certified-loss-v1";
export const LOSS_RESERVE_WINDOW_DAYS = 30;
export const LOSS_RESERVE_REFRESH_MS = 60 * 60 * 1000;
export const LOSS_RESERVE_STALE_MAX_MS = 24 * 60 * 60 * 1000;
export const LOSS_RESERVE_PRIOR_EXPOSURE_CENTS = 2_500_000; // $25,000 equivalent evidence prior.
export const LOSS_RESERVE_MAX_WINDOW_ORDERS = 1_000;

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

export type AutomaticLossReserveSnapshot = {
  version: typeof AUTOMATIC_LOSS_RESERVE_VERSION;
  currency: string;
  calculatedAt: string;
  windowStart: string;
  windowEnd: string;
  baselineBps: number;
  observedLossBps: number;
  evidenceWeightBps: number;
  lossReserveBps: number;
  certifiedOrderCount: number;
  incompleteOrderCount: number;
  realizedLossOrderCount: number;
  certifiedNetReceiptsCents: number;
  realizedLossCents: number;
};

export type ResolvedOperationalPricingPolicy = {
  policy: CartPricingPolicy;
  reserveSource: "automatic" | "stale_snapshot" | "baseline_fallback";
  snapshot: AutomaticLossReserveSnapshot | null;
};

function normalizeCurrency(value: string) {
  const currency = value.trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) throw new Error("LOSS_RESERVE_CURRENCY_INVALID");
  return currency;
}

function safeNonNegative(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field.toUpperCase()}_INVALID`);
  return value;
}

function safeBps(value: number, field: string) {
  const parsed = safeNonNegative(value, field);
  if (parsed > MAX_MONTHLY_LOSS_RESERVE_BPS) throw new Error(`${field.toUpperCase()}_INVALID`);
  return parsed;
}

/**
 * Shrinks the observed 30-day loss rate toward the current conservative baseline
 * until the window contains enough certified customer receipts to be credible.
 * This prevents one small early loss from immediately driving the reserve to 2%.
 */
export function calculateSmoothedLossReserveBps(input: {
  baselineBps: number;
  certifiedNetReceiptsCents: number;
  realizedLossCents: number;
  priorExposureCents?: number;
}) {
  const baselineBps = safeBps(input.baselineBps, "baseline_bps");
  const receipts = safeNonNegative(input.certifiedNetReceiptsCents, "certified_net_receipts_cents");
  const losses = safeNonNegative(input.realizedLossCents, "realized_loss_cents");
  const priorExposure = safeNonNegative(
    input.priorExposureCents ?? LOSS_RESERVE_PRIOR_EXPOSURE_CENTS,
    "prior_exposure_cents",
  );

  if (receipts === 0) {
    return { observedLossBps: 0, evidenceWeightBps: 0, lossReserveBps: baselineBps };
  }

  const observedLossBps = Math.min(
    MAX_MONTHLY_LOSS_RESERVE_BPS,
    Math.ceil((losses * 10_000) / receipts),
  );
  const evidenceWeightBps = Math.min(
    10_000,
    Math.floor((receipts * 10_000) / (receipts + priorExposure)),
  );
  const lossReserveBps = Math.min(
    MAX_MONTHLY_LOSS_RESERVE_BPS,
    Math.max(
      0,
      Math.round(
        (baselineBps * (10_000 - evidenceWeightBps) + observedLossBps * evidenceWeightBps) /
          10_000,
      ),
    ),
  );

  return { observedLossBps, evidenceWeightBps, lossReserveBps };
}

function cacheKey(currency: string) {
  return `pricing:${AUTOMATIC_LOSS_RESERVE_VERSION}:${currency}`;
}

function parseSnapshot(value: string, currency: string): AutomaticLossReserveSnapshot | null {
  try {
    const snapshot = JSON.parse(value) as AutomaticLossReserveSnapshot;
    if (
      snapshot.version !== AUTOMATIC_LOSS_RESERVE_VERSION ||
      snapshot.currency !== currency ||
      !Number.isSafeInteger(snapshot.lossReserveBps) ||
      snapshot.lossReserveBps < 0 ||
      snapshot.lossReserveBps > MAX_MONTHLY_LOSS_RESERVE_BPS ||
      !Number.isFinite(Date.parse(snapshot.calculatedAt))
    ) return null;
    return snapshot;
  } catch {
    return null;
  }
}

async function calculateTrailingSnapshot(
  currency: string,
  baselineBps: number,
  nowMs: number,
): Promise<AutomaticLossReserveSnapshot> {
  const windowEnd = new Date(nowMs);
  const windowStart = new Date(nowMs - LOSS_RESERVE_WINDOW_DAYS * 86_400_000);
  const orders = await prisma.order.findMany({
    where: {
      currency,
      paidAt: { gte: windowStart, lte: windowEnd },
      status: { in: ["paid", "partially_refunded", "refunded"] },
    },
    orderBy: { paidAt: "desc" },
    take: LOSS_RESERVE_MAX_WINDOW_ORDERS + 1,
    select: {
      subtotalCents: true,
      shippingCents: true,
      taxCents: true,
      totalCents: true,
      currency: true,
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

  if (orders.length > LOSS_RESERVE_MAX_WINDOW_ORDERS) {
    throw new Error("LOSS_RESERVE_WINDOW_ORDER_LIMIT_EXCEEDED");
  }

  const refundIds = orders.flatMap((order) => order.refunds.map((refund) => refund.id));
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

  let certifiedOrderCount = 0;
  let incompleteOrderCount = 0;
  let realizedLossOrderCount = 0;
  let certifiedNetReceiptsCents = 0;
  let realizedLossCents = 0;

  for (const order of orders) {
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

    const contribution = profit.contribution.certifiedOrderContributionCents;
    if (!profit.contribution.certified || contribution === null) {
      incompleteOrderCount += 1;
      continue;
    }

    certifiedOrderCount += 1;
    certifiedNetReceiptsCents += profit.receipts.netCustomerReceiptsCents;
    if (contribution < 0) {
      realizedLossOrderCount += 1;
      realizedLossCents += Math.abs(contribution);
    }
  }

  if (
    !Number.isSafeInteger(certifiedNetReceiptsCents) ||
    !Number.isSafeInteger(realizedLossCents)
  ) throw new Error("LOSS_RESERVE_AGGREGATE_INVALID");

  const smoothed = calculateSmoothedLossReserveBps({
    baselineBps,
    certifiedNetReceiptsCents,
    realizedLossCents,
  });

  return {
    version: AUTOMATIC_LOSS_RESERVE_VERSION,
    currency,
    calculatedAt: windowEnd.toISOString(),
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    baselineBps,
    observedLossBps: smoothed.observedLossBps,
    evidenceWeightBps: smoothed.evidenceWeightBps,
    lossReserveBps: smoothed.lossReserveBps,
    certifiedOrderCount,
    incompleteOrderCount,
    realizedLossOrderCount,
    certifiedNetReceiptsCents,
    realizedLossCents,
  };
}

export async function resolveOperationalCartPricingPolicy(
  currencyInput = "usd",
  nowMs = Date.now(),
): Promise<ResolvedOperationalPricingPolicy> {
  const currency = normalizeCurrency(currencyInput);
  const baseline = currentCartPricingPolicy();
  let cachedSnapshot: AutomaticLossReserveSnapshot | null = null;

  try {
    const cached = await prisma.cacheEntry.findUnique({ where: { key: cacheKey(currency) } });
    cachedSnapshot = cached ? parseSnapshot(cached.value, currency) : null;
    if (cachedSnapshot && cached && cached.expiresAt.getTime() > nowMs) {
      return {
        policy: { ...baseline, lossReserveBps: cachedSnapshot.lossReserveBps },
        reserveSource: "automatic",
        snapshot: cachedSnapshot,
      };
    }

    const snapshot = await calculateTrailingSnapshot(currency, baseline.lossReserveBps, nowMs);
    await prisma.cacheEntry.upsert({
      where: { key: cacheKey(currency) },
      create: {
        key: cacheKey(currency),
        value: JSON.stringify(snapshot),
        expiresAt: new Date(nowMs + LOSS_RESERVE_REFRESH_MS),
      },
      update: {
        value: JSON.stringify(snapshot),
        expiresAt: new Date(nowMs + LOSS_RESERVE_REFRESH_MS),
      },
    });
    return {
      policy: { ...baseline, lossReserveBps: snapshot.lossReserveBps },
      reserveSource: "automatic",
      snapshot,
    };
  } catch (error) {
    const cachedAt = cachedSnapshot ? Date.parse(cachedSnapshot.calculatedAt) : Number.NaN;
    if (cachedSnapshot && Number.isFinite(cachedAt) && nowMs - cachedAt <= LOSS_RESERVE_STALE_MAX_MS) {
      console.warn("pricing.loss_reserve.refresh_failed_using_stale_snapshot", {
        currency,
        error: error instanceof Error ? error.message : "UNKNOWN",
      });
      return {
        policy: { ...baseline, lossReserveBps: cachedSnapshot.lossReserveBps },
        reserveSource: "stale_snapshot",
        snapshot: cachedSnapshot,
      };
    }

    console.warn("pricing.loss_reserve.unavailable_using_baseline", {
      currency,
      error: error instanceof Error ? error.message : "UNKNOWN",
    });
    return { policy: baseline, reserveSource: "baseline_fallback", snapshot: null };
  }
}
