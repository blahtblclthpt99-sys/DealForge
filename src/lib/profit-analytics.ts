import { listRecoveryCases, type RecoveryLedgerEvent, type RecoveryRefundView } from "@/lib/recovery-reconciliation";
import { readStripeDisputeDecision } from "@/lib/stripe-dispute-integrity";

export const AUTHORITATIVE_PAYMENT_FEE_SOURCES = [
  "stripe_balance_transaction",
  "stripe_balance_transaction_webhook",
] as const;

type PaymentView = {
  status: string;
  amountCents: number;
  currency: string;
  meta: string;
};

type ProfitProcurementView = {
  expectedTotalCostCents: number | null;
  actualTotalCostCents: number | null;
  quantity: number;
  events: RecoveryLedgerEvent[];
};

type ProfitLineView = {
  id: string;
  lineTotalCents: number;
  procurementIntent: ProfitProcurementView | null;
};

type RefundFinancialView = {
  kind: string;
  amountCents: number;
  feeCents: number;
  netCents: number;
  currency: string;
  transactionType: string;
  balanceTransactionId?: string;
};

type ProfitRefundView = RecoveryRefundView & {
  currency: string;
  financialEvents?: RefundFinancialView[];
};

type PaymentFeeRecord = {
  feeCents: number;
  currency: string;
  source: (typeof AUTHORITATIVE_PAYMENT_FEE_SOURCES)[number];
  chargeId: string;
  balanceTransactionId: string;
  grossCents: number;
  netCents: number;
};

function safeNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function authoritativePaymentFee(payment: PaymentView): PaymentFeeRecord | null {
  if (payment.status !== "succeeded") return null;
  const meta = parseJsonObject(payment.meta);
  if (!meta) return null;
  const feeCents = safeNonNegativeInteger(meta.processingFeeCents);
  const grossCents = safeInteger(meta.processingFeeGrossCents);
  const netCents = safeInteger(meta.processingFeeNetCents);
  const source = meta.processingFeeSource;
  const chargeId = meta.processingFeeChargeId;
  const balanceTransactionId = meta.processingFeeBalanceTransactionId;
  const currency =
    typeof meta.processingFeeCurrency === "string"
      ? meta.processingFeeCurrency.trim().toLowerCase()
      : "";
  if (
    feeCents === null ||
    grossCents === null ||
    netCents === null ||
    netCents !== grossCents - feeCents ||
    typeof source !== "string" ||
    !(AUTHORITATIVE_PAYMENT_FEE_SOURCES as readonly string[]).includes(source) ||
    typeof chargeId !== "string" ||
    !/^ch_[A-Za-z0-9_]+$/.test(chargeId) ||
    typeof balanceTransactionId !== "string" ||
    !/^txn_[A-Za-z0-9_]+$/.test(balanceTransactionId) ||
    !/^[a-z]{3}$/.test(currency)
  ) {
    return null;
  }
  return {
    feeCents,
    currency,
    source: source as PaymentFeeRecord["source"],
    chargeId,
    balanceTransactionId,
    grossCents,
    netCents,
  };
}

function validSucceededRefundFinancialEvent(
  refund: ProfitRefundView,
  orderCurrency: string,
) {
  const events = refund.financialEvents || [];
  const debitEvents = events.filter((event) => event.kind === "refund_balance");
  const failureEvents = events.filter((event) => event.kind === "refund_failure_balance");
  if (debitEvents.length !== 1 || failureEvents.length !== 0) return null;
  const event = debitEvents[0];
  if (
    event.currency.toLowerCase() !== orderCurrency ||
    !Number.isSafeInteger(event.amountCents) ||
    event.amountCents !== -refund.amountCents ||
    !Number.isSafeInteger(event.feeCents) ||
    event.feeCents < 0 ||
    !Number.isSafeInteger(event.netCents) ||
    event.netCents !== event.amountCents - event.feeCents ||
    !["refund", "payment_refund"].includes(event.transactionType)
  ) {
    return null;
  }
  return event;
}

export function analyzeOrderProfit(input: {
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  refunds: ProfitRefundView[];
  payments: PaymentView[];
  items: ProfitLineView[];
}) {
  const orderCurrency = input.currency.toLowerCase();
  const activeRefunds = input.refunds.filter((refund) =>
    ["pending", "succeeded"].includes(refund.status),
  );
  const refundCurrencyMismatchCount = activeRefunds.filter(
    (refund) => refund.currency.toLowerCase() !== orderCurrency,
  ).length;
  const succeededRefunds = input.refunds.filter(
    (refund) => refund.status === "succeeded" && refund.currency.toLowerCase() === orderCurrency,
  );
  const succeededRefundCents = succeededRefunds.reduce(
    (sum, refund) => sum + refund.amountCents,
    0,
  );
  const pendingRefundCents = input.refunds
    .filter((refund) => refund.status === "pending" && refund.currency.toLowerCase() === orderCurrency)
    .reduce((sum, refund) => sum + refund.amountCents, 0);
  const failedRefundCount = input.refunds.filter((refund) => refund.status === "failed").length;
  const activeRefundExposureCents = succeededRefundCents + pendingRefundCents;
  const refundLedgerValid = refundCurrencyMismatchCount === 0 && activeRefundExposureCents <= input.totalCents;
  const netCustomerReceiptsCents = Math.max(0, input.totalCents - succeededRefundCents);
  const orderTotalBreakdownValid =
    input.subtotalCents + input.shippingCents + input.taxCents === input.totalCents;

  let knownActualSupplierCostCents = 0;
  let projectedSupplierCostCents = 0;
  let supplierRecoveredCents = 0;
  let acceptedLossCents = 0;
  let remainingRecoveryExposureCents = 0;
  let supplierCostComplete = input.items.length > 0;
  let recoveryProjectionValid = true;
  let openRecoveryCaseCount = 0;
  let overAccountedRecoveryCaseCount = 0;
  let aggregateOverAccountedIntentCount = 0;
  let recoveryCaseCount = 0;

  for (const item of input.items) {
    const intent = item.procurementIntent;
    if (!intent) {
      supplierCostComplete = false;
      continue;
    }

    const actual = safeNonNegativeInteger(intent.actualTotalCostCents);
    const expected = safeNonNegativeInteger(intent.expectedTotalCostCents);
    if (actual !== null) {
      knownActualSupplierCostCents += actual;
      projectedSupplierCostCents += actual;
    } else {
      supplierCostComplete = false;
      if (expected !== null) projectedSupplierCostCents += expected;
    }

    const cases = listRecoveryCases({
      events: intent.events,
      refunds: input.refunds,
      actualTotalCostCents: intent.actualTotalCostCents,
      intentQuantity: intent.quantity,
    });
    recoveryCaseCount += cases.length;
    let intentRecoveredCents = 0;
    let intentAcceptedLossCents = 0;

    for (const recovery of cases) {
      if (!recovery.ok) {
        recoveryProjectionValid = false;
        openRecoveryCaseCount += 1;
        continue;
      }
      intentRecoveredCents += recovery.supplierRecoveredCents;
      intentAcceptedLossCents += recovery.acceptedLossCents;
      supplierRecoveredCents += recovery.supplierRecoveredCents;
      acceptedLossCents += recovery.acceptedLossCents;
      if (recovery.remainingSupplierExposureCents !== null) {
        remainingRecoveryExposureCents += recovery.remainingSupplierExposureCents;
      }
      if (recovery.overAccounted) overAccountedRecoveryCaseCount += 1;
      if (!recovery.closed) openRecoveryCaseCount += 1;
    }

    if (actual !== null && intentRecoveredCents + intentAcceptedLossCents > actual) {
      aggregateOverAccountedIntentCount += 1;
    }
  }

  const recoveryAccountingValid =
    recoveryProjectionValid &&
    overAccountedRecoveryCaseCount === 0 &&
    aggregateOverAccountedIntentCount === 0;
  const netKnownSupplierCostCents = Math.max(
    0,
    knownActualSupplierCostCents - supplierRecoveredCents,
  );
  const netProjectedSupplierCostCents = Math.max(
    0,
    projectedSupplierCostCents - supplierRecoveredCents,
  );

  const succeededPayments = input.payments.filter(
    (payment) => payment.status === "succeeded" && payment.currency.toLowerCase() === orderCurrency,
  );
  const succeededPaymentAmountCents = succeededPayments.reduce(
    (sum, payment) => sum + payment.amountCents,
    0,
  );
  const paymentCurrencyMismatchCount = input.payments.filter(
    (payment) => payment.status === "succeeded" && payment.currency.toLowerCase() !== orderCurrency,
  ).length;
  const paymentLedgerValid =
    paymentCurrencyMismatchCount === 0 &&
    succeededPayments.length === 1 &&
    succeededPaymentAmountCents === input.totalCents;

  let activeDisputeCount = 0;
  let lostDisputeCount = 0;
  let invalidDisputeStateCount = 0;
  for (const payment of succeededPayments) {
    const dispute = readStripeDisputeDecision(payment.meta);
    if (!dispute.ok) {
      invalidDisputeStateCount += 1;
      continue;
    }
    activeDisputeCount += dispute.activeDisputeIds.length;
    lostDisputeCount += dispute.lostDisputeIds.length;
  }
  const disputeStateClear =
    invalidDisputeStateCount === 0 && activeDisputeCount === 0 && lostDisputeCount === 0;

  let chargeProcessingFeeCents = 0;
  let authoritativePaymentFeeCount = 0;
  for (const payment of succeededPayments) {
    const record = authoritativePaymentFee(payment);
    if (!record || record.currency !== orderCurrency) continue;
    chargeProcessingFeeCents += record.feeCents;
    authoritativePaymentFeeCount += 1;
  }
  const chargeProcessingFeeComplete =
    paymentLedgerValid && authoritativePaymentFeeCount === succeededPayments.length;

  let refundProcessingFeeCents = 0;
  let reconciledSucceededRefundCount = 0;
  for (const refund of succeededRefunds) {
    const event = validSucceededRefundFinancialEvent(refund, orderCurrency);
    if (!event) continue;
    refundProcessingFeeCents += event.feeCents;
    reconciledSucceededRefundCount += 1;
  }
  const refundProcessingAdjustmentComplete =
    reconciledSucceededRefundCount === succeededRefunds.length;
  const paymentProcessingCostComplete =
    chargeProcessingFeeComplete && refundProcessingAdjustmentComplete && failedRefundCount === 0;
  const knownPaymentProcessingFeeCents = chargeProcessingFeeCents + refundProcessingFeeCents;

  // Collected tax is a liability, not contribution. Once a taxable order is partially/full refunded,
  // the exact retained tax liability is not inferred from a lump-sum refund without authoritative tax allocation.
  const taxLiabilityComplete = input.taxCents === 0 || succeededRefundCents === 0;
  const knownTaxLiabilityCents = taxLiabilityComplete ? input.taxCents : null;

  const contributionBeforeTaxAndPaymentFeesCents =
    netCustomerReceiptsCents - netKnownSupplierCostCents;
  const projectedContributionBeforeTaxAndPaymentFeesCents =
    netCustomerReceiptsCents - netProjectedSupplierCostCents;

  const finalizationReasons: string[] = [];
  if (!orderTotalBreakdownValid) finalizationReasons.push("ORDER_TOTAL_BREAKDOWN_INVALID");
  if (!refundLedgerValid) finalizationReasons.push("REFUND_LEDGER_INVALID");
  if (!paymentLedgerValid) finalizationReasons.push("PAYMENT_LEDGER_INVALID");
  if (!supplierCostComplete) finalizationReasons.push("SUPPLIER_COST_INCOMPLETE");
  if (!chargeProcessingFeeComplete) finalizationReasons.push("PAYMENT_PROCESSING_COST_UNKNOWN");
  if (!refundProcessingAdjustmentComplete) {
    finalizationReasons.push("REFUND_PROCESSING_ADJUSTMENT_UNKNOWN");
  }
  if (failedRefundCount > 0) finalizationReasons.push("REFUND_FAILED_REQUIRES_MANUAL_REVIEW");
  if (!taxLiabilityComplete) finalizationReasons.push("REFUND_TAX_ALLOCATION_UNKNOWN");
  if (pendingRefundCents > 0) finalizationReasons.push("REFUND_PENDING");
  if (!recoveryAccountingValid) finalizationReasons.push("RECOVERY_ACCOUNTING_INVALID");
  if (openRecoveryCaseCount > 0) finalizationReasons.push("RECOVERY_CASE_OPEN");
  if (invalidDisputeStateCount > 0) finalizationReasons.push("PAYMENT_DISPUTE_STATE_INVALID");
  if (activeDisputeCount > 0) finalizationReasons.push("PAYMENT_DISPUTE_ACTIVE");
  if (lostDisputeCount > 0) finalizationReasons.push("PAYMENT_DISPUTE_LOST");

  const certified = finalizationReasons.length === 0;
  const certifiedOrderContributionCents = certified
    ? netCustomerReceiptsCents -
      netKnownSupplierCostCents -
      (knownTaxLiabilityCents || 0) -
      knownPaymentProcessingFeeCents
    : null;
  const certifiedContributionMarginBps =
    certifiedOrderContributionCents !== null && netCustomerReceiptsCents > 0
      ? Math.round((certifiedOrderContributionCents / netCustomerReceiptsCents) * 10_000)
      : null;

  return {
    scope: {
      metric: "order_contribution",
      excludes: ["marketing_cac", "support_overhead", "chargeback_settlement_until_reconciled"],
      acceptedLossTreatment: "disclosure_only_not_double_counted",
      refundPrincipalTreatment: "reduces_customer_receipts_only_not_processing_cost",
    },
    integrity: {
      orderTotalBreakdownValid,
      refundLedgerValid,
      refundCurrencyMismatchCount,
      paymentLedgerValid,
      paymentCurrencyMismatchCount,
      disputeStateClear,
      activeDisputeCount,
      lostDisputeCount,
      invalidDisputeStateCount,
    },
    receipts: {
      subtotalCents: input.subtotalCents,
      shippingCents: input.shippingCents,
      taxCents: input.taxCents,
      grossCustomerReceiptsCents: input.totalCents,
      succeededRefundCents,
      pendingRefundCents,
      netCustomerReceiptsCents,
    },
    supplier: {
      supplierCostComplete,
      knownActualSupplierCostCents,
      projectedSupplierCostCents,
      supplierRecoveredCents,
      netKnownSupplierCostCents,
      netProjectedSupplierCostCents,
      acceptedLossCents,
      remainingRecoveryExposureCents,
    },
    recovery: {
      recoveryCaseCount,
      openRecoveryCaseCount,
      overAccountedRecoveryCaseCount,
      aggregateOverAccountedIntentCount,
      accountingValid: recoveryAccountingValid,
    },
    paymentProcessing: {
      succeededPaymentCount: succeededPayments.length,
      succeededPaymentAmountCents,
      authoritativeFeeCount: authoritativePaymentFeeCount,
      chargeFeeComplete: chargeProcessingFeeComplete,
      chargeFeeCents: chargeProcessingFeeCents,
      succeededRefundCount: succeededRefunds.length,
      reconciledSucceededRefundCount,
      failedRefundCount,
      refundAdjustmentComplete: refundProcessingAdjustmentComplete,
      refundFeeCents: refundProcessingFeeCents,
      complete: paymentProcessingCostComplete,
      knownFeeCents: knownPaymentProcessingFeeCents,
    },
    tax: {
      complete: taxLiabilityComplete,
      knownLiabilityCents: knownTaxLiabilityCents,
    },
    contribution: {
      contributionBeforeTaxAndPaymentFeesCents,
      projectedContributionBeforeTaxAndPaymentFeesCents,
      certifiedOrderContributionCents,
      certifiedContributionMarginBps,
      certified,
      finalizationReasons,
    },
  };
}
