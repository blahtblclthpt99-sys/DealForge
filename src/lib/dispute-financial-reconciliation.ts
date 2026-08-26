import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { StripeBalanceTransaction } from "@/lib/stripe-commerce";

export const DISPUTE_FINANCIAL_KINDS = [
  "dispute_withdrawal",
  "dispute_reinstatement",
] as const;

export type DisputeFinancialKind = (typeof DISPUTE_FINANCIAL_KINDS)[number];

export type DisputeFinancialEvidence = {
  kind: DisputeFinancialKind;
  providerDisputeId: string;
  paymentIntentId: string;
  chargeId: string;
  disputedAmountCents: number;
  disputedCurrency: string;
  balanceTransactionId: string;
  amountCents: number;
  feeCents: number;
  netCents: number;
  currency: string;
  transactionType: string;
  reportingCategory: string;
  sourceObjectId: string;
};

export type DisputeFinancialRow = DisputeFinancialEvidence & {
  id: string;
  eventKey: string;
  paymentId: string;
  providerEventId: string | null;
  createdAt: Date | string;
};

type DisputeLike = {
  id?: unknown;
  amount?: unknown;
  currency?: unknown;
  payment_intent?: unknown;
  charge?: unknown;
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

function normalizedCurrency(value: unknown) {
  return typeof value === "string" && /^[A-Za-z]{3}$/.test(value.trim())
    ? value.trim().toLowerCase()
    : null;
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function validateDisputeFinancialEvidence(input: {
  dispute: DisputeLike;
  balanceTransaction: StripeBalanceTransaction;
  kind: DisputeFinancialKind;
}) {
  const disputeId = nonEmptyString(input.dispute.id);
  const paymentIntentId = objectId(input.dispute.payment_intent);
  const chargeId = objectId(input.dispute.charge);
  const disputedAmountCents = safeInteger(input.dispute.amount);
  const disputedCurrency = normalizedCurrency(input.dispute.currency);

  const balanceTransactionId = nonEmptyString(input.balanceTransaction.id);
  const amountCents = safeInteger(input.balanceTransaction.amount);
  const feeCents = safeInteger(input.balanceTransaction.fee);
  const netCents = safeInteger(input.balanceTransaction.net);
  const currency = normalizedCurrency(input.balanceTransaction.currency);
  const transactionType = nonEmptyString(input.balanceTransaction.type);
  const reportingCategory = nonEmptyString(input.balanceTransaction.reporting_category);
  const sourceObjectId = objectId(input.balanceTransaction.source);

  if (!disputeId || !/^dp_[A-Za-z0-9_]+$/.test(disputeId)) {
    return { ok: false as const, reason: "DISPUTE_FINANCIAL_DISPUTE_ID_INVALID" as const };
  }
  if (!paymentIntentId || !/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId)) {
    return { ok: false as const, reason: "DISPUTE_FINANCIAL_PAYMENT_INTENT_INVALID" as const };
  }
  if (!chargeId || !/^ch_[A-Za-z0-9_]+$/.test(chargeId)) {
    return { ok: false as const, reason: "DISPUTE_FINANCIAL_CHARGE_INVALID" as const };
  }
  if (disputedAmountCents === null || disputedAmountCents <= 0 || !disputedCurrency) {
    return { ok: false as const, reason: "DISPUTE_FINANCIAL_DISPUTE_INVALID" as const };
  }
  if (!balanceTransactionId || !/^txn_[A-Za-z0-9_]+$/.test(balanceTransactionId)) {
    return { ok: false as const, reason: "DISPUTE_FINANCIAL_BALANCE_TRANSACTION_INVALID" as const };
  }
  if (
    amountCents === null ||
    amountCents === 0 ||
    feeCents === null ||
    feeCents < 0 ||
    netCents === null ||
    netCents !== amountCents - feeCents ||
    !currency ||
    !transactionType ||
    !reportingCategory ||
    !sourceObjectId
  ) {
    return { ok: false as const, reason: "DISPUTE_FINANCIAL_BALANCE_EVIDENCE_INVALID" as const };
  }
  if (sourceObjectId !== disputeId) {
    return { ok: false as const, reason: "DISPUTE_FINANCIAL_SOURCE_MISMATCH" as const };
  }
  if (currency === disputedCurrency && Math.abs(amountCents) > disputedAmountCents) {
    return { ok: false as const, reason: "DISPUTE_FINANCIAL_AMOUNT_EXCEEDS_DISPUTE" as const };
  }

  if (input.kind === "dispute_withdrawal") {
    if (reportingCategory !== "dispute") {
      return { ok: false as const, reason: "DISPUTE_FINANCIAL_REPORTING_CATEGORY_INVALID" as const };
    }
    if (!["adjustment", "adjusted_for_overdraft_transaction"].includes(transactionType)) {
      return { ok: false as const, reason: "DISPUTE_FINANCIAL_TRANSACTION_TYPE_INVALID" as const };
    }
    if (amountCents >= 0 || netCents >= 0) {
      return { ok: false as const, reason: "DISPUTE_FINANCIAL_WITHDRAWAL_DIRECTION_INVALID" as const };
    }
  } else {
    if (reportingCategory !== "dispute_reversal") {
      return { ok: false as const, reason: "DISPUTE_FINANCIAL_REPORTING_CATEGORY_INVALID" as const };
    }
    if (transactionType !== "adjustment") {
      return { ok: false as const, reason: "DISPUTE_FINANCIAL_TRANSACTION_TYPE_INVALID" as const };
    }
    if (amountCents <= 0 || netCents <= 0) {
      return { ok: false as const, reason: "DISPUTE_FINANCIAL_REINSTATEMENT_DIRECTION_INVALID" as const };
    }
  }

  return {
    ok: true as const,
    evidence: {
      kind: input.kind,
      providerDisputeId: disputeId,
      paymentIntentId,
      chargeId,
      disputedAmountCents,
      disputedCurrency,
      balanceTransactionId,
      amountCents,
      feeCents,
      netCents,
      currency,
      transactionType,
      reportingCategory,
      sourceObjectId,
    } satisfies DisputeFinancialEvidence,
  };
}

export function disputeFinancialEventKey(evidence: DisputeFinancialEvidence) {
  return `dispute-financial:${evidence.providerDisputeId}:${evidence.kind}:${evidence.balanceTransactionId}`;
}

function deterministicRowId(eventKey: string) {
  const digest = createHash("sha256").update(eventKey).digest("hex").slice(0, 28);
  return `dfe_${digest}`;
}

export async function persistDisputeFinancialEvidence(
  tx: Prisma.TransactionClient,
  input: {
    paymentId: string;
    providerEventId?: string | null;
    evidence: DisputeFinancialEvidence;
  },
) {
  const eventKey = disputeFinancialEventKey(input.evidence);
  const id = deterministicRowId(eventKey);
  const providerEventId = input.providerEventId || null;

  await tx.$executeRaw(
    Prisma.sql`
      INSERT INTO "DisputeFinancialEvent" (
        "id", "eventKey", "paymentId", "providerDisputeId", "paymentIntentId", "chargeId",
        "providerEventId", "providerBalanceTransactionId", "kind", "disputedAmountCents",
        "disputedCurrency", "amountCents", "feeCents", "netCents", "currency",
        "transactionType", "reportingCategory", "sourceObjectId"
      ) VALUES (
        ${id}, ${eventKey}, ${input.paymentId}, ${input.evidence.providerDisputeId},
        ${input.evidence.paymentIntentId}, ${input.evidence.chargeId}, ${providerEventId},
        ${input.evidence.balanceTransactionId}, ${input.evidence.kind},
        ${input.evidence.disputedAmountCents}, ${input.evidence.disputedCurrency},
        ${input.evidence.amountCents}, ${input.evidence.feeCents}, ${input.evidence.netCents},
        ${input.evidence.currency}, ${input.evidence.transactionType},
        ${input.evidence.reportingCategory}, ${input.evidence.sourceObjectId}
      )
      ON CONFLICT DO NOTHING
    `,
  );

  const rows = await tx.$queryRaw<DisputeFinancialRow[]>(
    Prisma.sql`
      SELECT
        "id", "eventKey", "paymentId", "providerDisputeId", "paymentIntentId", "chargeId",
        "providerEventId", "providerBalanceTransactionId" AS "balanceTransactionId", "kind",
        "disputedAmountCents", "disputedCurrency", "amountCents", "feeCents", "netCents",
        "currency", "transactionType", "reportingCategory", "sourceObjectId", "createdAt"
      FROM "DisputeFinancialEvent"
      WHERE "eventKey" = ${eventKey}
         OR "providerBalanceTransactionId" = ${input.evidence.balanceTransactionId}
      ORDER BY "createdAt" ASC
      LIMIT 2
    `,
  );

  if (rows.length !== 1) throw new Error("DISPUTE_FINANCIAL_EVENT_KEY_CONFLICT");
  const row = rows[0];
  const exact =
    row.eventKey === eventKey &&
    row.paymentId === input.paymentId &&
    row.providerDisputeId === input.evidence.providerDisputeId &&
    row.paymentIntentId === input.evidence.paymentIntentId &&
    row.chargeId === input.evidence.chargeId &&
    row.balanceTransactionId === input.evidence.balanceTransactionId &&
    row.kind === input.evidence.kind &&
    row.disputedAmountCents === input.evidence.disputedAmountCents &&
    row.disputedCurrency === input.evidence.disputedCurrency &&
    row.amountCents === input.evidence.amountCents &&
    row.feeCents === input.evidence.feeCents &&
    row.netCents === input.evidence.netCents &&
    row.currency === input.evidence.currency &&
    row.transactionType === input.evidence.transactionType &&
    row.reportingCategory === input.evidence.reportingCategory &&
    row.sourceObjectId === input.evidence.sourceObjectId;

  if (!exact) throw new Error("DISPUTE_FINANCIAL_IMMUTABLE_MISMATCH");
  return row;
}
