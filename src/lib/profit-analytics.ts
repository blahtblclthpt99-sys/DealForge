import { listRecoveryCases, type RecoveryLedgerEvent, type RecoveryRefundView } from "@/lib/recovery-reconciliation";

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

type ProfitRefundView = RecoveryRefundView & {
  currency: string;
};

type PaymentFeeRecord = {
  feeCents: number;
  currency: string;
  source: (typeof AUTHORITATIVE_PAYMENT_FEE_SOURCES)[number];
};

function safeNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
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
  const source = meta.processingFeeSource;
  const currency = typeof meta.processingFeeCurrency === "string"
    ? meta.processingFeeCurrency.trim().toLowerCase()
    : payment.currency.trim().toLowerCase();
  if (
    feeCents === null ||
    typeof source !== "string" ||
    !(AUTHORITATIVE_PAYMENT_FEE_SOURCES as readonly string[]).includes(source) ||
    !/^[a-z]{3}$/.test(currency)
  ) {
    return null;
  }
  return {
    feeCents,
    currency,
    source: source as PaymentFeeRecord["source"],
  };
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
  const succeededRefundCents = input.refunds
    .filter((refund) => refund.status === "succeeded" && refund.currency.toLowerCase() === orderCurrency)
    .reduce((sum, refund) => sum + refund.amountCents, 0);
  const pendingRefundCents = input.refunds
    .filter((refund) => refund.status === "pending" && refund.currency.toLowerCase() === orderCurrency)
    .reduce((sum, refund) => sum + refund.amountCents, 0);
  const netCustomerReceiptsCents = Math.max(0, input.totalCents - succeededRefundCents);

  let knownActualSupplierCostCents = 0;
  let projectedSupplierCostCents = 0;
  let supplierRecoveredCents = 0;
  let acceptedLossCents = 0;
  let remainingRecoveryExposureCents = 0;
  let supplierCostComplete = input.items.length > 0;
  let recoveryProjectionValid = true;
  let openRecoveryCaseCount = 0;
  let overAccountedRecoveryCaseCount = 0;
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
    for (const recovery of cases) {
      if (!recovery.ok) {
        recoveryProjectionValid = false;
        openRecoveryCaseCount += 1;
        continue;
      }
      supplierRecoveredCents += recovery.supplierRecoveredCents;
      acceptedLossCents += recovery.acceptedLossCents;
      if (recovery.remainingSupplierExposureCents !== null) {
        remainingRecoveryExposureCents += recovery.remainingSupplierExposureCents;
      }
      if (recovery.overAccounted) overAccountedRecoveryCaseCount += 1;
      if (!recovery.closed) openRecoveryCaseCount += 1;
    }
  }

  const recoveryAccountingValid = recoveryProjectionValid && overAccountedRecoveryCaseCount === 0;
  const netKnownSupplierCostCents = Math.max(0, knownActualSupplierCostCents - supplierRecoveredCents);
  const netProjectedSupplierCostCents = Math.max(0, projectedSupplierCostCents - supplierRecoveredCents);

  const succeededPayments = input.payments.filter(
    (payment) => payment.status === "succeeded" && payment.currency.toLowerCase() === orderCurrency,
  );
  let knownPaymentProcessingFeeCents = 0;
  let authoritativePaymentFeeCount = 0;
  for (const payment of succeededPayments) {
    const record = authoritativePaymentFee(payment);
    if (!record || record.currency !== orderCurrency) continue;
    knownPaymentProcessingFeeCents += record.feeCents;
    authoritativePaymentFeeCount += 1;
  }
  const paymentProcessingCostComplete =
    succeededPayments.length > 0 && authoritativePaymentFeeCount === succeededPayments.length;

  // Collected tax is a liability, not contribution. Once a taxable order is partially/full refunded,
  // the exact retained tax liability is not inferred from a lump-sum refund without authoritative tax allocation.
  const taxLiabilityComplete = input.taxCents === 0 || succeededRefundCents === 0;
  const knownTaxLiabilityCents = taxLiabilityComplete ? input.taxCents : null;

  const contributionBeforeTaxAndPaymentFeesCents =
    netCustomerReceiptsCents - netKnownSupplierCostCents;
  const projectedContributionBeforeTaxAndPaymentFeesCents =
    netCustomerReceiptsCents - netProjectedSupplierCostCents;

  const finalizationReasons: string[] = [];
  if (!supplierCostComplete) finalizationReasons.push("SUPPLIER_COST_INCOMPLETE");
  if (!paymentProcessingCostComplete) finalizationReasons.push("PAYMENT_PROCESSING_COST_UNKNOWN");
  if (!taxLiabilityComplete) finalizationReasons.push("REFUND_TAX_ALLOCATION_UNKNOWN");
  if (pendingRefundCents > 0) finalizationReasons.push("REFUND_PENDING");
  if (!recoveryAccountingValid) finalizationReasons.push("RECOVERY_ACCOUNTING_INVALID");
  if (openRecoveryCaseCount > 0) finalizationReasons.push("RECOVERY_CASE_OPEN");

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
      excludes: ["marketing_cac", "support_overhead", "chargeback_loss_unless_recorded_elsewhere"],
      acceptedLossTreatment: "disclosure_only_not_double_counted",
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
      accountingValid: recoveryAccountingValid,
    },
    paymentProcessing: {
      succeededPaymentCount: succeededPayments.length,
      authoritativeFeeCount: authoritativePaymentFeeCount,
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
