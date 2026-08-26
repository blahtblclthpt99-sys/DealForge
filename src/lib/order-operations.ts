export type OperationsSeverity = "info" | "warning" | "critical";

export type OperationsException = {
  code: string;
  severity: OperationsSeverity;
  orderItemId?: string;
};

type ProcurementView = {
  status: string;
  blockedReason: string | null;
  expectedTotalCostCents: number | null;
  actualTotalCostCents: number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type OrderLineView = {
  id: string;
  lineTotalCents: number;
  procurementIntent: ProcurementView | null;
};

type RefundView = {
  status: string;
  amountCents: number;
};

const HOURS = 60 * 60 * 1000;
const DAYS = 24 * HOURS;

function timestamp(value: Date | string) {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function analyzeOrderOperations(input: {
  orderStatus?: string;
  totalCents: number;
  items: OrderLineView[];
  refunds: RefundView[];
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const exceptions: OperationsException[] = [];
  const succeededRefundCents = input.refunds
    .filter((refund) => refund.status === "succeeded")
    .reduce((sum, refund) => sum + refund.amountCents, 0);
  const pendingRefundCents = input.refunds
    .filter((refund) => refund.status === "pending")
    .reduce((sum, refund) => sum + refund.amountCents, 0);
  const retainedRevenueCents = Math.max(0, input.totalCents - succeededRefundCents);

  if (input.orderStatus === "payment_disputed") {
    exceptions.push({ code: "PAYMENT_DISPUTE_ACTIVE", severity: "critical" });
  } else if (input.orderStatus === "payment_dispute_lost") {
    exceptions.push({ code: "PAYMENT_DISPUTE_LOST", severity: "critical" });
  }

  let expectedSupplierCostCents = 0;
  let knownActualSupplierCostCents = 0;
  let projectedSupplierCostCents = 0;
  let reconciledLineCount = 0;
  let missingCostLineCount = 0;

  for (const item of input.items) {
    const intent = item.procurementIntent;
    if (!intent) {
      exceptions.push({ code: "MISSING_PROCUREMENT_INTENT", severity: "critical", orderItemId: item.id });
      missingCostLineCount += 1;
      continue;
    }

    if (intent.blockedReason || intent.status === "blocked_source_integrity") {
      exceptions.push({ code: "SOURCE_INTEGRITY_BLOCKED", severity: "critical", orderItemId: item.id });
    }

    const expected = intent.expectedTotalCostCents;
    const actual = intent.actualTotalCostCents;
    if (expected !== null && Number.isSafeInteger(expected) && expected >= 0) {
      expectedSupplierCostCents += expected;
    }
    if (actual !== null && Number.isSafeInteger(actual) && actual >= 0) {
      knownActualSupplierCostCents += actual;
      projectedSupplierCostCents += actual;
      reconciledLineCount += 1;
      if (expected !== null && actual > expected) {
        const overrun = actual - expected;
        const severe = expected > 0 && overrun / expected >= 0.2;
        exceptions.push({
          code: severe ? "SUPPLIER_COST_OVERRUN_HIGH" : "SUPPLIER_COST_OVERRUN",
          severity: severe ? "critical" : "warning",
          orderItemId: item.id,
        });
      }
      if (actual >= item.lineTotalCents) {
        exceptions.push({ code: "NEGATIVE_OR_ZERO_LINE_MARGIN", severity: "critical", orderItemId: item.id });
      }
    } else if (expected !== null && Number.isSafeInteger(expected) && expected >= 0) {
      projectedSupplierCostCents += expected;
      missingCostLineCount += 1;
    } else {
      missingCostLineCount += 1;
    }

    const updatedAt = timestamp(intent.updatedAt);
    const createdAt = timestamp(intent.createdAt);
    if (intent.status === "awaiting_review" && createdAt !== null && nowMs - createdAt >= 24 * HOURS) {
      exceptions.push({ code: "AWAITING_REVIEW_OVER_24H", severity: "warning", orderItemId: item.id });
    }
    if (
      intent.status === "supplier_ordered_manual" &&
      updatedAt !== null &&
      nowMs - updatedAt >= 72 * HOURS
    ) {
      exceptions.push({ code: "SUPPLIER_ORDER_NOT_SHIPPED_OVER_72H", severity: "warning", orderItemId: item.id });
    }
    if (intent.status === "shipped" && updatedAt !== null && nowMs - updatedAt >= 14 * DAYS) {
      exceptions.push({ code: "SHIPMENT_NOT_DELIVERED_OVER_14D", severity: "warning", orderItemId: item.id });
    }
  }

  if (pendingRefundCents > 0) {
    exceptions.push({ code: "REFUND_PENDING", severity: "warning" });
  }
  if (succeededRefundCents > input.totalCents) {
    exceptions.push({ code: "REFUND_EXCEEDS_ORDER_TOTAL", severity: "critical" });
  }

  const projectedContributionCents = retainedRevenueCents - projectedSupplierCostCents;
  const knownContributionCents = retainedRevenueCents - knownActualSupplierCostCents;
  const fullyCostReconciled = input.items.length > 0 && reconciledLineCount === input.items.length;

  const severityRank: Record<OperationsSeverity, number> = { info: 0, warning: 1, critical: 2 };
  const highestSeverity = exceptions.reduce<OperationsSeverity | null>((highest, item) => {
    if (!highest || severityRank[item.severity] > severityRank[highest]) return item.severity;
    return highest;
  }, null);

  return {
    financials: {
      orderTotalCents: input.totalCents,
      succeededRefundCents,
      pendingRefundCents,
      retainedRevenueCents,
      expectedSupplierCostCents,
      knownActualSupplierCostCents,
      projectedSupplierCostCents,
      projectedContributionCents,
      knownContributionCents,
      fullyCostReconciled,
      reconciledLineCount,
      missingCostLineCount,
    },
    exceptions,
    exceptionCount: exceptions.length,
    highestSeverity,
  };
}
