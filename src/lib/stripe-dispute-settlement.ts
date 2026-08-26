import type { StripeBalanceTransaction } from "@/lib/stripe-commerce";

export const STRIPE_DISPUTE_SETTLEMENT_EVENT_TYPES = [
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
] as const;

export type StripeDisputeSettlementEventType =
  (typeof STRIPE_DISPUTE_SETTLEMENT_EVENT_TYPES)[number];
export type StripeDisputeSettlementKind = "funds_withdrawn" | "funds_reinstated";

export type StripeDisputeSettlementEvidence = {
  disputeId: string;
  paymentIntentId: string;
  chargeId: string;
  disputeAmountCents: number;
  disputeCurrency: string;
  kind: StripeDisputeSettlementKind;
  balanceTransactionId: string;
  amountCents: number;
  feeCents: number;
  netCents: number;
  currency: string;
  source: string;
  status: string;
  type: string | null;
  reportingCategory: string | null;
};

type SettlementRecord = StripeDisputeSettlementEvidence & {
  eventId: string;
  eventType: StripeDisputeSettlementEventType;
  eventCreated: number;
  reconciledAt: string;
};

type SettlementEntry = {
  withdrawn?: SettlementRecord;
  reinstated?: SettlementRecord;
};

type SettlementLedger = {
  version: 1;
  entries: Record<string, SettlementEntry>;
};

type PaymentMetaRoot = Record<string, unknown> & {
  stripeDisputeSettlementsV1?: SettlementLedger;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isCurrency(value: unknown): value is string {
  return typeof value === "string" && /^[a-z]{3}$/.test(value);
}

function isId(value: unknown, prefix: string) {
  return typeof value === "string" && new RegExp(`^${prefix}_[A-Za-z0-9_]+$`).test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function parseSettlementRecord(value: unknown): SettlementRecord | null {
  if (!isRecord(value)) return null;
  if (
    !isId(value.disputeId, "dp") ||
    !isId(value.paymentIntentId, "pi") ||
    !isId(value.chargeId, "ch") ||
    !isPositiveSafeInteger(value.disputeAmountCents) ||
    !isCurrency(value.disputeCurrency) ||
    (value.kind !== "funds_withdrawn" && value.kind !== "funds_reinstated") ||
    !isId(value.balanceTransactionId, "txn") ||
    !isSafeInteger(value.amountCents) ||
    !isSafeInteger(value.feeCents) ||
    value.feeCents < 0 ||
    !isSafeInteger(value.netCents) ||
    !isCurrency(value.currency) ||
    value.source !== value.disputeId ||
    (value.status !== "available" && value.status !== "pending") ||
    (value.type !== null && typeof value.type !== "string") ||
    (value.reportingCategory !== null && typeof value.reportingCategory !== "string") ||
    !isId(value.eventId, "evt") ||
    !STRIPE_DISPUTE_SETTLEMENT_EVENT_TYPES.includes(
      value.eventType as StripeDisputeSettlementEventType,
    ) ||
    !isPositiveSafeInteger(value.eventCreated) ||
    !isIsoTimestamp(value.reconciledAt)
  ) {
    return null;
  }
  if (value.netCents !== value.amountCents - value.feeCents) return null;
  if (Math.abs(value.amountCents) !== value.disputeAmountCents) return null;
  if (value.kind === "funds_withdrawn" && value.amountCents >= 0) return null;
  if (value.kind === "funds_reinstated" && value.amountCents <= 0) return null;
  if (value.currency !== value.disputeCurrency) return null;

  return value as unknown as SettlementRecord;
}

function parseLedger(meta: string):
  | { ok: true; root: PaymentMetaRoot; entries: Record<string, SettlementEntry> }
  | { ok: false; reason: "PAYMENT_META_INVALID" | "PAYMENT_DISPUTE_SETTLEMENT_META_INVALID" } {
  let parsed: unknown;
  try {
    parsed = meta.trim() ? JSON.parse(meta) : {};
  } catch {
    return { ok: false, reason: "PAYMENT_META_INVALID" };
  }
  if (!isRecord(parsed)) return { ok: false, reason: "PAYMENT_META_INVALID" };
  const root = parsed as PaymentMetaRoot;
  if (root.stripeDisputeSettlementsV1 === undefined) {
    return { ok: true, root, entries: {} };
  }
  const ledger = root.stripeDisputeSettlementsV1;
  if (!isRecord(ledger) || ledger.version !== 1 || !isRecord(ledger.entries)) {
    return { ok: false, reason: "PAYMENT_DISPUTE_SETTLEMENT_META_INVALID" };
  }
  const entries: Record<string, SettlementEntry> = {};
  for (const [disputeId, rawEntry] of Object.entries(ledger.entries)) {
    if (!isId(disputeId, "dp") || !isRecord(rawEntry)) {
      return { ok: false, reason: "PAYMENT_DISPUTE_SETTLEMENT_META_INVALID" };
    }
    const withdrawn = rawEntry.withdrawn === undefined ? undefined : parseSettlementRecord(rawEntry.withdrawn);
    const reinstated = rawEntry.reinstated === undefined ? undefined : parseSettlementRecord(rawEntry.reinstated);
    if ((rawEntry.withdrawn !== undefined && !withdrawn) || (rawEntry.reinstated !== undefined && !reinstated)) {
      return { ok: false, reason: "PAYMENT_DISPUTE_SETTLEMENT_META_INVALID" };
    }
    if ((withdrawn && withdrawn.disputeId !== disputeId) || (reinstated && reinstated.disputeId !== disputeId)) {
      return { ok: false, reason: "PAYMENT_DISPUTE_SETTLEMENT_META_INVALID" };
    }
    entries[disputeId] = { withdrawn, reinstated };
  }
  return { ok: true, root, entries };
}

export function validateStripeDisputeSettlementEvidence(input: {
  dispute: Record<string, unknown>;
  balanceTransaction: StripeBalanceTransaction;
  kind: StripeDisputeSettlementKind;
}):
  | { ok: true; evidence: StripeDisputeSettlementEvidence }
  | { ok: false; reason: string } {
  const disputeId = typeof input.dispute.id === "string" ? input.dispute.id : "";
  const paymentIntentId =
    typeof input.dispute.payment_intent === "string" ? input.dispute.payment_intent : "";
  const chargeId = typeof input.dispute.charge === "string" ? input.dispute.charge : "";
  const disputeAmountCents = input.dispute.amount;
  const disputeCurrency =
    typeof input.dispute.currency === "string" ? input.dispute.currency.toLowerCase() : "";
  const tx = input.balanceTransaction;
  const currency = typeof tx.currency === "string" ? tx.currency.toLowerCase() : "";
  const source = typeof tx.source === "string" ? tx.source : "";
  const status = typeof tx.status === "string" ? tx.status : "";

  if (!isId(disputeId, "dp") || !isId(paymentIntentId, "pi") || !isId(chargeId, "ch")) {
    return { ok: false, reason: "STRIPE_DISPUTE_SETTLEMENT_BINDING_INVALID" };
  }
  if (!isPositiveSafeInteger(disputeAmountCents) || !isCurrency(disputeCurrency)) {
    return { ok: false, reason: "STRIPE_DISPUTE_SETTLEMENT_DISPUTE_INVALID" };
  }
  if (!isId(tx.id, "txn") || !isSafeInteger(tx.amount) || !isSafeInteger(tx.fee) || !isSafeInteger(tx.net)) {
    return { ok: false, reason: "STRIPE_DISPUTE_SETTLEMENT_BALANCE_TRANSACTION_INVALID" };
  }
  if (tx.fee < 0 || tx.net !== tx.amount - tx.fee) {
    return { ok: false, reason: "STRIPE_DISPUTE_SETTLEMENT_BALANCE_MATH_INVALID" };
  }
  if (source !== disputeId) {
    return { ok: false, reason: "STRIPE_DISPUTE_SETTLEMENT_SOURCE_MISMATCH" };
  }
  if (currency !== disputeCurrency) {
    return { ok: false, reason: "STRIPE_DISPUTE_SETTLEMENT_CURRENCY_MISMATCH" };
  }
  if (Math.abs(tx.amount) !== disputeAmountCents) {
    return { ok: false, reason: "STRIPE_DISPUTE_SETTLEMENT_AMOUNT_MISMATCH" };
  }
  if (input.kind === "funds_withdrawn" && tx.amount >= 0) {
    return { ok: false, reason: "STRIPE_DISPUTE_WITHDRAWAL_SIGN_INVALID" };
  }
  if (input.kind === "funds_reinstated" && tx.amount <= 0) {
    return { ok: false, reason: "STRIPE_DISPUTE_REINSTATEMENT_SIGN_INVALID" };
  }
  if (status !== "available" && status !== "pending") {
    return { ok: false, reason: "STRIPE_DISPUTE_SETTLEMENT_STATUS_INVALID" };
  }

  return {
    ok: true,
    evidence: {
      disputeId,
      paymentIntentId,
      chargeId,
      disputeAmountCents,
      disputeCurrency,
      kind: input.kind,
      balanceTransactionId: tx.id,
      amountCents: tx.amount,
      feeCents: tx.fee,
      netCents: tx.net,
      currency,
      source,
      status,
      type: typeof tx.type === "string" ? tx.type : null,
      reportingCategory: typeof tx.reporting_category === "string" ? tx.reporting_category : null,
    },
  };
}

export function mergeStripeDisputeSettlementMeta(input: {
  currentMeta: string;
  evidence: StripeDisputeSettlementEvidence;
  eventId: string;
  eventType: StripeDisputeSettlementEventType;
  eventCreated: number;
  reconciledAt: string;
}):
  | { ok: true; meta: string; restored: boolean }
  | { ok: false; reason: string } {
  const parsed = parseLedger(input.currentMeta);
  if (!parsed.ok) return parsed;
  if (!isId(input.eventId, "evt") || !isPositiveSafeInteger(input.eventCreated) || !isIsoTimestamp(input.reconciledAt)) {
    return { ok: false, reason: "STRIPE_DISPUTE_SETTLEMENT_EVENT_INVALID" };
  }
  const expectedEventType =
    input.evidence.kind === "funds_withdrawn"
      ? "charge.dispute.funds_withdrawn"
      : "charge.dispute.funds_reinstated";
  if (input.eventType !== expectedEventType) {
    return { ok: false, reason: "STRIPE_DISPUTE_SETTLEMENT_EVENT_TYPE_MISMATCH" };
  }

  const current = parsed.entries[input.evidence.disputeId] || {};
  const slot = input.evidence.kind === "funds_withdrawn" ? "withdrawn" : "reinstated";
  const existing = current[slot];
  const record: SettlementRecord = {
    ...input.evidence,
    eventId: input.eventId,
    eventType: input.eventType,
    eventCreated: input.eventCreated,
    reconciledAt: input.reconciledAt,
  };
  if (existing) {
    if (existing.balanceTransactionId !== record.balanceTransactionId) {
      return { ok: false, reason: "STRIPE_DISPUTE_SETTLEMENT_DUPLICATE_KIND_CONFLICT" };
    }
    if (JSON.stringify(existing) === JSON.stringify(record)) {
      return {
        ok: true,
        meta: input.currentMeta,
        restored: Boolean(current.reinstated?.status === "available"),
      };
    }
    if (
      existing.disputeId !== record.disputeId ||
      existing.paymentIntentId !== record.paymentIntentId ||
      existing.chargeId !== record.chargeId ||
      existing.disputeAmountCents !== record.disputeAmountCents ||
      existing.currency !== record.currency ||
      existing.amountCents !== record.amountCents ||
      existing.netCents !== record.netCents
    ) {
      return { ok: false, reason: "STRIPE_DISPUTE_SETTLEMENT_IMMUTABLE_FIELD_MISMATCH" };
    }
  }

  const nextEntry: SettlementEntry = { ...current, [slot]: record };
  if (nextEntry.withdrawn && nextEntry.reinstated) {
    if (
      nextEntry.withdrawn.paymentIntentId !== nextEntry.reinstated.paymentIntentId ||
      nextEntry.withdrawn.chargeId !== nextEntry.reinstated.chargeId ||
      nextEntry.withdrawn.disputeAmountCents !== nextEntry.reinstated.disputeAmountCents ||
      nextEntry.withdrawn.currency !== nextEntry.reinstated.currency
    ) {
      return { ok: false, reason: "STRIPE_DISPUTE_SETTLEMENT_PAIR_MISMATCH" };
    }
  }

  const entries = { ...parsed.entries, [input.evidence.disputeId]: nextEntry };
  const root: PaymentMetaRoot = {
    ...parsed.root,
    stripeDisputeSettlementsV1: { version: 1, entries },
  };
  return {
    ok: true,
    meta: JSON.stringify(root),
    restored: Boolean(nextEntry.reinstated?.status === "available"),
  };
}

export function readStripeDisputeSettlementDecision(currentMeta: string):
  | {
      ok: true;
      reinstatedDisputeIds: string[];
      withdrawnDisputeIds: string[];
      pendingReinstatementDisputeIds: string[];
    }
  | { ok: false; reason: "PAYMENT_META_INVALID" | "PAYMENT_DISPUTE_SETTLEMENT_META_INVALID" } {
  const parsed = parseLedger(currentMeta);
  if (!parsed.ok) return parsed;
  const reinstatedDisputeIds: string[] = [];
  const withdrawnDisputeIds: string[] = [];
  const pendingReinstatementDisputeIds: string[] = [];
  for (const [disputeId, entry] of Object.entries(parsed.entries)) {
    if (entry.withdrawn) withdrawnDisputeIds.push(disputeId);
    if (entry.reinstated?.status === "available") reinstatedDisputeIds.push(disputeId);
    else if (entry.reinstated?.status === "pending") pendingReinstatementDisputeIds.push(disputeId);
  }
  return {
    ok: true,
    reinstatedDisputeIds: reinstatedDisputeIds.sort(),
    withdrawnDisputeIds: withdrawnDisputeIds.sort(),
    pendingReinstatementDisputeIds: pendingReinstatementDisputeIds.sort(),
  };
}
