import { readStripeDisputeSettlementDecision } from "@/lib/stripe-dispute-settlement";

export const STRIPE_DISPUTE_EVENT_TYPES = [
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
] as const;

export type StripeDisputeEventType = (typeof STRIPE_DISPUTE_EVENT_TYPES)[number];

export type StripeDisputeSnapshot = {
  disputeId: string;
  paymentIntentId: string;
  chargeId: string;
  amountCents: number;
  currency: string;
  status: string;
  reason: string | null;
};

export type StripeDisputeLedgerEntry = StripeDisputeSnapshot & {
  lastEventId: string;
  lastEventType: StripeDisputeEventType;
  eventCreated: number;
  updatedAt: string;
};

export type StripeDisputeDisposition = "clear" | "active" | "lost";

export type StripeDisputeLedgerDecision = {
  disposition: StripeDisputeDisposition;
  activeDisputeIds: string[];
  lostDisputeIds: string[];
};

type StripeDisputesV1 = {
  version: 1;
  entries: Record<string, StripeDisputeLedgerEntry>;
};

type PaymentMetaRoot = Record<string, unknown> & {
  stripeDisputesV1?: StripeDisputesV1;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCurrency(value: unknown): value is string {
  return typeof value === "string" && /^[a-z]{3}$/.test(value);
}

function isDisputeId(value: unknown): value is string {
  return typeof value === "string" && /^dp_[A-Za-z0-9]+$/.test(value);
}

function isPaymentIntentId(value: unknown): value is string {
  return typeof value === "string" && /^pi_[A-Za-z0-9]+$/.test(value);
}

function isChargeId(value: unknown): value is string {
  return typeof value === "string" && /^ch_[A-Za-z0-9]+$/.test(value);
}

function isEventId(value: unknown): value is string {
  return typeof value === "string" && /^evt_[A-Za-z0-9_]+$/.test(value);
}

function isDisputeEventType(value: unknown): value is StripeDisputeEventType {
  return typeof value === "string" &&
    (STRIPE_DISPUTE_EVENT_TYPES as readonly string[]).includes(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  return Number.isFinite(Date.parse(value));
}

function parseLedgerEntry(value: unknown): StripeDisputeLedgerEntry | null {
  if (!isRecord(value)) return null;
  const reason = value.reason === null || typeof value.reason === "string" ? value.reason : undefined;
  if (
    !isDisputeId(value.disputeId) ||
    !isPaymentIntentId(value.paymentIntentId) ||
    !isChargeId(value.chargeId) ||
    !isPositiveSafeInteger(value.amountCents) ||
    !isCurrency(value.currency) ||
    !isNonEmptyString(value.status) ||
    reason === undefined ||
    !isEventId(value.lastEventId) ||
    !isDisputeEventType(value.lastEventType) ||
    !isPositiveSafeInteger(value.eventCreated) ||
    !isIsoTimestamp(value.updatedAt)
  ) {
    return null;
  }
  return {
    disputeId: value.disputeId,
    paymentIntentId: value.paymentIntentId,
    chargeId: value.chargeId,
    amountCents: value.amountCents,
    currency: value.currency,
    status: value.status.trim(),
    reason: reason === null ? null : reason.trim() || null,
    lastEventId: value.lastEventId,
    lastEventType: value.lastEventType,
    eventCreated: value.eventCreated,
    updatedAt: value.updatedAt,
  };
}

function parsePaymentMeta(currentMeta: string):
  | { ok: true; root: PaymentMetaRoot; entries: Record<string, StripeDisputeLedgerEntry> }
  | { ok: false; reason: "PAYMENT_META_INVALID" | "PAYMENT_DISPUTE_META_INVALID" } {
  let parsed: unknown;
  try {
    parsed = currentMeta.trim() ? JSON.parse(currentMeta) : {};
  } catch {
    return { ok: false, reason: "PAYMENT_META_INVALID" };
  }
  if (!isRecord(parsed)) return { ok: false, reason: "PAYMENT_META_INVALID" };

  const root = parsed as PaymentMetaRoot;
  if (root.stripeDisputesV1 === undefined) {
    return { ok: true, root, entries: {} };
  }
  if (
    !isRecord(root.stripeDisputesV1) ||
    root.stripeDisputesV1.version !== 1 ||
    !isRecord(root.stripeDisputesV1.entries)
  ) {
    return { ok: false, reason: "PAYMENT_DISPUTE_META_INVALID" };
  }

  const entries: Record<string, StripeDisputeLedgerEntry> = {};
  for (const [key, raw] of Object.entries(root.stripeDisputesV1.entries)) {
    const entry = parseLedgerEntry(raw);
    if (!entry || key !== entry.disputeId) {
      return { ok: false, reason: "PAYMENT_DISPUTE_META_INVALID" };
    }
    entries[key] = entry;
  }
  return { ok: true, root, entries };
}

// warning_closed never became a formal chargeback withdrawal. A formal `won`
// dispute is only financially safe after a separately reconciled Stripe Balance
// Transaction proves that the withdrawn principal has been reinstated.
function isSafeResolvedStatus(status: string) {
  return status === "warning_closed";
}

function isLostStatus(status: string) {
  return status === "lost";
}

function isTerminalStatus(status: string) {
  return status === "won" || isSafeResolvedStatus(status) || isLostStatus(status);
}

export function classifyStripeDisputeEntries(
  entries: Record<string, StripeDisputeLedgerEntry>,
): StripeDisputeLedgerDecision {
  const activeDisputeIds: string[] = [];
  const lostDisputeIds: string[] = [];

  for (const entry of Object.values(entries)) {
    if (isLostStatus(entry.status)) lostDisputeIds.push(entry.disputeId);
    else if (!isSafeResolvedStatus(entry.status)) activeDisputeIds.push(entry.disputeId);
  }

  activeDisputeIds.sort();
  lostDisputeIds.sort();
  return {
    disposition: lostDisputeIds.length > 0 ? "lost" : activeDisputeIds.length > 0 ? "active" : "clear",
    activeDisputeIds,
    lostDisputeIds,
  };
}

export function readStripeDisputeDecision(currentMeta: string):
  | ({ ok: true } & StripeDisputeLedgerDecision)
  | {
      ok: false;
      reason:
        | "PAYMENT_META_INVALID"
        | "PAYMENT_DISPUTE_META_INVALID"
        | "PAYMENT_DISPUTE_SETTLEMENT_META_INVALID";
    } {
  const parsed = parsePaymentMeta(currentMeta);
  if (!parsed.ok) return parsed;
  const settlement = readStripeDisputeSettlementDecision(currentMeta);
  if (!settlement.ok) return settlement;

  const reinstated = new Set(settlement.reinstatedDisputeIds);
  const activeDisputeIds: string[] = [];
  const lostDisputeIds: string[] = [];
  for (const entry of Object.values(parsed.entries)) {
    if (isLostStatus(entry.status)) {
      lostDisputeIds.push(entry.disputeId);
      continue;
    }
    if (isSafeResolvedStatus(entry.status)) continue;
    if (entry.status === "won" && reinstated.has(entry.disputeId)) continue;
    activeDisputeIds.push(entry.disputeId);
  }
  activeDisputeIds.sort();
  lostDisputeIds.sort();
  return {
    ok: true,
    disposition: lostDisputeIds.length > 0 ? "lost" : activeDisputeIds.length > 0 ? "active" : "clear",
    activeDisputeIds,
    lostDisputeIds,
  };
}

export function mergeStripeDisputeMeta(input: {
  currentMeta: string;
  dispute: StripeDisputeSnapshot;
  eventId: string;
  eventType: StripeDisputeEventType;
  eventCreated: number;
  reconciledAt: string;
}):
  | ({ ok: true; meta: string; stale: boolean } & StripeDisputeLedgerDecision)
  | {
      ok: false;
      reason:
        | "PAYMENT_META_INVALID"
        | "PAYMENT_DISPUTE_META_INVALID"
        | "STRIPE_DISPUTE_INVALID"
        | "STRIPE_DISPUTE_IMMUTABLE_FIELD_MISMATCH"
        | "STRIPE_DISPUTE_TERMINAL_STATE_CONFLICT";
    } {
  const parsed = parsePaymentMeta(input.currentMeta);
  if (!parsed.ok) return parsed;

  const dispute = {
    ...input.dispute,
    currency: input.dispute.currency.toLowerCase(),
    status: input.dispute.status.trim(),
    reason: input.dispute.reason?.trim() || null,
  };
  if (
    !isDisputeId(dispute.disputeId) ||
    !isPaymentIntentId(dispute.paymentIntentId) ||
    !isChargeId(dispute.chargeId) ||
    !isPositiveSafeInteger(dispute.amountCents) ||
    !isCurrency(dispute.currency) ||
    !isNonEmptyString(dispute.status) ||
    !isEventId(input.eventId) ||
    !isDisputeEventType(input.eventType) ||
    !isPositiveSafeInteger(input.eventCreated) ||
    !isIsoTimestamp(input.reconciledAt)
  ) {
    return { ok: false, reason: "STRIPE_DISPUTE_INVALID" };
  }

  const existing = parsed.entries[dispute.disputeId];
  if (existing) {
    if (
      existing.paymentIntentId !== dispute.paymentIntentId ||
      existing.chargeId !== dispute.chargeId ||
      existing.amountCents !== dispute.amountCents ||
      existing.currency !== dispute.currency
    ) {
      return { ok: false, reason: "STRIPE_DISPUTE_IMMUTABLE_FIELD_MISMATCH" };
    }

    if (isTerminalStatus(existing.status) && existing.status !== dispute.status) {
      return { ok: false, reason: "STRIPE_DISPUTE_TERMINAL_STATE_CONFLICT" };
    }

    const staleNonterminalSameSecond =
      input.eventCreated === existing.eventCreated &&
      existing.status !== dispute.status &&
      !isTerminalStatus(dispute.status);
    if (input.eventCreated < existing.eventCreated || staleNonterminalSameSecond) {
      return {
        ok: true,
        meta: input.currentMeta,
        stale: true,
        ...classifyStripeDisputeEntries(parsed.entries),
      };
    }
  }

  const nextEntry: StripeDisputeLedgerEntry = {
    ...dispute,
    lastEventId: input.eventId,
    lastEventType: input.eventType,
    eventCreated: input.eventCreated,
    updatedAt: input.reconciledAt,
  };
  const entries = { ...parsed.entries, [dispute.disputeId]: nextEntry };
  const decision = classifyStripeDisputeEntries(entries);
  const root: PaymentMetaRoot = {
    ...parsed.root,
    stripeDisputesV1: { version: 1, entries },
  };

  return {
    ok: true,
    meta: JSON.stringify(root),
    stale: false,
    ...decision,
  };
}

export function deriveFinancialOrderStatus(input: {
  paymentMeta: string;
  succeededRefundCents: number;
  totalCents: number;
}):
  | {
      ok: true;
      status: "paid" | "partially_refunded" | "refunded" | "payment_disputed" | "payment_dispute_lost";
      disposition: StripeDisputeDisposition;
      activeDisputeIds: string[];
      lostDisputeIds: string[];
    }
  | {
      ok: false;
      reason:
        | "PAYMENT_META_INVALID"
        | "PAYMENT_DISPUTE_META_INVALID"
        | "PAYMENT_DISPUTE_SETTLEMENT_META_INVALID"
        | "FINANCIAL_ORDER_TOTALS_INVALID";
    } {
  if (
    !Number.isSafeInteger(input.succeededRefundCents) ||
    input.succeededRefundCents < 0 ||
    !Number.isSafeInteger(input.totalCents) ||
    input.totalCents <= 0 ||
    input.succeededRefundCents > input.totalCents
  ) {
    return { ok: false, reason: "FINANCIAL_ORDER_TOTALS_INVALID" };
  }

  const disputes = readStripeDisputeDecision(input.paymentMeta);
  if (!disputes.ok) return disputes;

  const status = disputes.disposition === "lost"
    ? "payment_dispute_lost"
    : disputes.disposition === "active"
      ? "payment_disputed"
      : input.succeededRefundCents >= input.totalCents
        ? "refunded"
        : input.succeededRefundCents > 0
          ? "partially_refunded"
          : "paid";

  return {
    ok: true,
    status,
    disposition: disputes.disposition,
    activeDisputeIds: disputes.activeDisputeIds,
    lostDisputeIds: disputes.lostDisputeIds,
  };
}
