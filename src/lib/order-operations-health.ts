import type { FulfillmentState } from "./order-fulfillment";

export type OrderOperationsSeverity = "healthy" | "warning" | "critical" | "complete" | "blocked";

export type OrderOperationsReason =
  | "ON_TRACK"
  | "ORDER_COMPLETE"
  | "FINANCIAL_NOT_PAID"
  | "FULFILLMENT_STATE_MISSING"
  | "STATE_TIMESTAMP_MISSING"
  | "AWAITING_SOURCING_OVERDUE"
  | "SOURCING_OVERDUE"
  | "SUPPLIER_ORDERED_OVERDUE"
  | "SHIPMENT_STALE"
  | "HOLD_STALE";

export type OrderOperationsHealth = {
  actionable: boolean;
  severity: OrderOperationsSeverity;
  reason: OrderOperationsReason;
  ageMs: number | null;
  warningAfterMs: number | null;
  criticalAfterMs: number | null;
};

export type OrderOperationsHealthInput = {
  financialStatus: string;
  fulfillmentState: FulfillmentState | null;
  paidAtMs: number | null;
  stateEnteredAtMs: number | null;
  nowMs?: number;
};

type Threshold = { warningMs: number; criticalMs: number; reason: OrderOperationsReason };

export const ORDER_OPERATIONS_THRESHOLDS: Readonly<Record<Exclude<FulfillmentState, "delivered">, Threshold>> = {
  awaiting_sourcing: {
    warningMs: 2 * 60 * 60 * 1000,
    criticalMs: 6 * 60 * 60 * 1000,
    reason: "AWAITING_SOURCING_OVERDUE",
  },
  sourcing: {
    warningMs: 6 * 60 * 60 * 1000,
    criticalMs: 24 * 60 * 60 * 1000,
    reason: "SOURCING_OVERDUE",
  },
  supplier_ordered: {
    warningMs: 24 * 60 * 60 * 1000,
    criticalMs: 72 * 60 * 60 * 1000,
    reason: "SUPPLIER_ORDERED_OVERDUE",
  },
  shipped: {
    warningMs: 5 * 24 * 60 * 60 * 1000,
    criticalMs: 10 * 24 * 60 * 60 * 1000,
    reason: "SHIPMENT_STALE",
  },
  hold: {
    warningMs: 24 * 60 * 60 * 1000,
    criticalMs: 72 * 60 * 60 * 1000,
    reason: "HOLD_STALE",
  },
};

function finiteTimestamp(value: number | null) {
  return value != null && Number.isFinite(value) && value >= 0 ? value : null;
}

export function evaluateOrderOperationsHealth(input: OrderOperationsHealthInput): OrderOperationsHealth {
  if (input.financialStatus !== "paid") {
    return {
      actionable: false,
      severity: "blocked",
      reason: "FINANCIAL_NOT_PAID",
      ageMs: null,
      warningAfterMs: null,
      criticalAfterMs: null,
    };
  }

  if (!input.fulfillmentState) {
    return {
      actionable: false,
      severity: "critical",
      reason: "FULFILLMENT_STATE_MISSING",
      ageMs: null,
      warningAfterMs: null,
      criticalAfterMs: null,
    };
  }

  if (input.fulfillmentState === "delivered") {
    return {
      actionable: false,
      severity: "complete",
      reason: "ORDER_COMPLETE",
      ageMs: null,
      warningAfterMs: null,
      criticalAfterMs: null,
    };
  }

  const anchor = input.fulfillmentState === "awaiting_sourcing"
    ? finiteTimestamp(input.paidAtMs)
    : finiteTimestamp(input.stateEnteredAtMs);
  if (anchor == null) {
    return {
      actionable: true,
      severity: "critical",
      reason: "STATE_TIMESTAMP_MISSING",
      ageMs: null,
      warningAfterMs: null,
      criticalAfterMs: null,
    };
  }

  const now = Number.isFinite(input.nowMs) ? (input.nowMs as number) : Date.now();
  const ageMs = Math.max(0, now - anchor);
  const threshold = ORDER_OPERATIONS_THRESHOLDS[input.fulfillmentState];
  const severity: OrderOperationsSeverity = ageMs >= threshold.criticalMs
    ? "critical"
    : ageMs >= threshold.warningMs
      ? "warning"
      : "healthy";

  return {
    actionable: true,
    severity,
    reason: severity === "healthy" ? "ON_TRACK" : threshold.reason,
    ageMs,
    warningAfterMs: threshold.warningMs,
    criticalAfterMs: threshold.criticalMs,
  };
}

export function orderOperationsAlertSource(orderId: string) {
  return `order-operations-alert:${orderId}`;
}

export function orderOperationsAlertFingerprint(input: {
  fulfillmentState: FulfillmentState;
  severity: Extract<OrderOperationsSeverity, "warning" | "critical">;
  stateEnteredAtMs: number | null;
  reason: OrderOperationsReason;
}) {
  return [
    input.fulfillmentState,
    input.severity,
    input.reason,
    input.stateEnteredAtMs == null ? "missing" : String(input.stateEnteredAtMs),
  ].join(":");
}
