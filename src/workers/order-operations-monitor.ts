import { prisma } from "../lib/db";
import { fulfillmentLogSource, stateFromFulfillmentMeta } from "../lib/order-fulfillment";
import {
  evaluateOrderOperationsHealth,
  orderOperationsAlertFingerprint,
  orderOperationsAlertSource,
} from "../lib/order-operations-health";
import { parseJson } from "../lib/utils";

const DEFAULT_SCAN_LIMIT = 200;
const MAX_SCAN_LIMIT = 500;

export type OrderOperationsMonitorResult = {
  scanned: number;
  healthy: number;
  warning: number;
  critical: number;
  alertsCreated: number;
  alertsDeduplicated: number;
  reasons: Record<string, number>;
};

export async function monitorOrderOperations(
  limit = DEFAULT_SCAN_LIMIT,
): Promise<OrderOperationsMonitorResult> {
  const safeLimit = Math.min(MAX_SCAN_LIMIT, Math.max(1, Math.trunc(limit)));
  const orders = await prisma.order.findMany({
    where: { status: "paid", paidAt: { not: null } },
    orderBy: { paidAt: "asc" },
    take: safeLimit,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paidAt: true,
    },
  });

  if (orders.length === 0) {
    return {
      scanned: 0,
      healthy: 0,
      warning: 0,
      critical: 0,
      alertsCreated: 0,
      alertsDeduplicated: 0,
      reasons: {},
    };
  }

  const fulfillmentSources = orders.map((order) => fulfillmentLogSource(order.id));
  const alertSources = orders.map((order) => orderOperationsAlertSource(order.id));
  const [fulfillmentLogs, alertLogs] = await Promise.all([
    prisma.systemLog.findMany({
      where: { source: { in: fulfillmentSources } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.systemLog.findMany({
      where: { source: { in: alertSources } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const latestFulfillment = new Map<string, (typeof fulfillmentLogs)[number]>();
  for (const log of fulfillmentLogs) {
    if (!latestFulfillment.has(log.source)) latestFulfillment.set(log.source, log);
  }

  const latestAlert = new Map<string, (typeof alertLogs)[number]>();
  for (const log of alertLogs) {
    if (!latestAlert.has(log.source)) latestAlert.set(log.source, log);
  }

  const now = new Date();
  const reasons: Record<string, number> = {};
  let healthy = 0;
  let warning = 0;
  let critical = 0;
  let alertsCreated = 0;
  let alertsDeduplicated = 0;

  for (const order of orders) {
    const fulfillmentSource = fulfillmentLogSource(order.id);
    const fulfillmentLog = latestFulfillment.get(fulfillmentSource);
    const fulfillmentMeta = fulfillmentLog
      ? parseJson<Record<string, unknown>>(fulfillmentLog.meta, {})
      : {};
    const fulfillmentState = stateFromFulfillmentMeta(fulfillmentMeta) || "awaiting_sourcing";
    const stateEnteredAtMs = fulfillmentState === "awaiting_sourcing"
      ? order.paidAt?.getTime() ?? null
      : fulfillmentLog?.createdAt.getTime() ?? null;

    const health = evaluateOrderOperationsHealth({
      financialStatus: order.status,
      fulfillmentState,
      paidAtMs: order.paidAt?.getTime() ?? null,
      stateEnteredAtMs,
      nowMs: now.getTime(),
    });

    if (health.severity === "healthy" || health.severity === "complete") {
      healthy += 1;
      continue;
    }
    if (health.severity !== "warning" && health.severity !== "critical") continue;

    if (health.severity === "warning") warning += 1;
    else critical += 1;
    reasons[health.reason] = (reasons[health.reason] || 0) + 1;

    const fingerprint = orderOperationsAlertFingerprint({
      fulfillmentState,
      severity: health.severity,
      stateEnteredAtMs,
      reason: health.reason,
    });
    const alertSource = orderOperationsAlertSource(order.id);
    const previous = latestAlert.get(alertSource);
    const previousMeta = previous ? parseJson<Record<string, unknown>>(previous.meta, {}) : {};
    if (previousMeta.fingerprint === fingerprint) {
      alertsDeduplicated += 1;
      continue;
    }

    await prisma.systemLog.create({
      data: {
        level: health.severity === "critical" ? "error" : "warn",
        source: alertSource,
        message: health.reason,
        meta: JSON.stringify({
          fingerprint,
          orderId: order.id,
          orderNumber: order.orderNumber,
          financialStatus: order.status,
          fulfillmentState,
          severity: health.severity,
          reason: health.reason,
          ageMs: health.ageMs,
          warningAfterMs: health.warningAfterMs,
          criticalAfterMs: health.criticalAfterMs,
          stateEnteredAt: stateEnteredAtMs == null ? null : new Date(stateEnteredAtMs).toISOString(),
          observedAt: now.toISOString(),
          automaticOrderActionsEnabled: false,
          automaticSupplierPurchasingEnabled: false,
        }),
      },
    });
    alertsCreated += 1;
  }

  return {
    scanned: orders.length,
    healthy,
    warning,
    critical,
    alertsCreated,
    alertsDeduplicated,
    reasons,
  };
}
