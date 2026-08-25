export const STRIPE_FEE_SOURCE = "stripe_balance_transaction" as const;
export const STRIPE_FEE_WEBHOOK_SOURCE = "stripe_balance_transaction_webhook" as const;

export type StripeFeeEvidence = {
  paymentIntentId: string;
  chargeId: string;
  chargeAmountCents: number;
  chargeCurrency: string;
  balanceTransactionId: string;
  feeCents: number;
  grossCents: number;
  netCents: number;
  currency: string;
};

type ChargeLike = {
  id?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
  payment_intent?: unknown;
  balance_transaction?: unknown;
};

type BalanceTransactionLike = {
  id?: unknown;
  amount?: unknown;
  fee?: unknown;
  net?: unknown;
  currency?: unknown;
  source?: unknown;
  type?: unknown;
  reporting_category?: unknown;
};

function objectId(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const id = (value as Record<string, unknown>).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

function safeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function currency(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z]{3}$/.test(value.trim())
    ? value.trim().toLowerCase()
    : null;
}

export function validateStripeFeeEvidence(input: {
  paymentIntentId: string;
  charge: ChargeLike;
  balanceTransaction: BalanceTransactionLike;
}) {
  const paymentIntentId = input.paymentIntentId;
  const chargeId = typeof input.charge.id === "string" ? input.charge.id : null;
  const chargePaymentIntentId = objectId(input.charge.payment_intent);
  const balanceTransactionId = objectId(input.charge.balance_transaction);
  const actualBalanceTransactionId =
    typeof input.balanceTransaction.id === "string" ? input.balanceTransaction.id : null;
  const chargeAmount = safeInteger(input.charge.amount);
  const chargeCurrency = currency(input.charge.currency);
  const balanceAmount = safeInteger(input.balanceTransaction.amount);
  const feeCents = safeInteger(input.balanceTransaction.fee);
  const netCents = safeInteger(input.balanceTransaction.net);
  const balanceCurrency = currency(input.balanceTransaction.currency);
  const balanceSource = objectId(input.balanceTransaction.source);

  if (!/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId)) {
    return { ok: false as const, reason: "STRIPE_FEE_PAYMENT_INTENT_INVALID" as const };
  }
  if (!chargeId || !/^ch_[A-Za-z0-9_]+$/.test(chargeId)) {
    return { ok: false as const, reason: "STRIPE_FEE_CHARGE_INVALID" as const };
  }
  if (chargePaymentIntentId !== paymentIntentId) {
    return { ok: false as const, reason: "STRIPE_FEE_PAYMENT_INTENT_MISMATCH" as const };
  }
  if (!balanceTransactionId || !/^txn_[A-Za-z0-9_]+$/.test(balanceTransactionId)) {
    return { ok: false as const, reason: "STRIPE_FEE_BALANCE_TRANSACTION_MISSING" as const };
  }
  if (actualBalanceTransactionId !== balanceTransactionId) {
    return { ok: false as const, reason: "STRIPE_FEE_BALANCE_TRANSACTION_MISMATCH" as const };
  }
  if (input.charge.status && input.charge.status !== "succeeded") {
    return { ok: false as const, reason: "STRIPE_FEE_CHARGE_NOT_SUCCEEDED" as const };
  }
  if (
    chargeAmount === null ||
    chargeAmount <= 0 ||
    !chargeCurrency ||
    balanceAmount === null ||
    feeCents === null ||
    feeCents < 0 ||
    netCents === null ||
    !balanceCurrency
  ) {
    return { ok: false as const, reason: "STRIPE_FEE_EVIDENCE_INVALID" as const };
  }
  if (balanceSource && balanceSource !== chargeId) {
    return { ok: false as const, reason: "STRIPE_FEE_BALANCE_SOURCE_MISMATCH" as const };
  }
  if (chargeCurrency === balanceCurrency) {
    if (balanceAmount !== chargeAmount || netCents !== balanceAmount - feeCents) {
      return { ok: false as const, reason: "STRIPE_FEE_BALANCE_MATH_MISMATCH" as const };
    }
  }

  return {
    ok: true as const,
    evidence: {
      paymentIntentId,
      chargeId,
      chargeAmountCents: chargeAmount,
      chargeCurrency,
      balanceTransactionId,
      feeCents,
      grossCents: balanceAmount,
      netCents,
      currency: balanceCurrency,
    } satisfies StripeFeeEvidence,
  };
}

function parseMeta(meta: string) {
  try {
    const parsed = JSON.parse(meta) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function mergeStripeFeeMeta(input: {
  currentMeta: string;
  evidence: StripeFeeEvidence;
  source: typeof STRIPE_FEE_SOURCE | typeof STRIPE_FEE_WEBHOOK_SOURCE;
  reconciledAt: string;
  eventId?: string | null;
}) {
  const meta = parseMeta(input.currentMeta);
  const existingBalanceTransactionId = meta.processingFeeBalanceTransactionId;
  const existingChargeId = meta.processingFeeChargeId;
  const existingFeeCents = meta.processingFeeCents;
  const existingCurrency = meta.processingFeeCurrency;

  if (
    existingBalanceTransactionId !== undefined &&
    (existingBalanceTransactionId !== input.evidence.balanceTransactionId ||
      existingChargeId !== input.evidence.chargeId ||
      existingFeeCents !== input.evidence.feeCents ||
      existingCurrency !== input.evidence.currency)
  ) {
    return { ok: false as const, reason: "STRIPE_FEE_IMMUTABLE_MISMATCH" as const };
  }

  return {
    ok: true as const,
    meta: JSON.stringify({
      ...meta,
      processingFeeCents: input.evidence.feeCents,
      processingFeeCurrency: input.evidence.currency,
      processingFeeSource: input.source,
      processingFeeChargeId: input.evidence.chargeId,
      processingFeeBalanceTransactionId: input.evidence.balanceTransactionId,
      processingFeeGrossCents: input.evidence.grossCents,
      processingFeeNetCents: input.evidence.netCents,
      processingFeeReconciledAt: input.reconciledAt,
      processingFeeEventId: input.eventId || null,
    }),
  };
}
