import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { StripeBalanceTransaction } from "@/lib/stripe-commerce";

export const REFUND_FINANCIAL_KINDS = [
  "refund_balance",
  "refund_failure_balance",
] as const;

export type RefundFinancialKind = (typeof REFUND_FINANCIAL_KINDS)[number];

export type RefundFinancialEvidence = {
  kind: RefundFinancialKind;
  providerRefundId: string;
  paymentIntentId: string | null;
  balanceTransactionId: string;
  amountCents: number;
  feeCents: number;
  netCents: number;
  currency: string;
  transactionType: string;
  reportingCategory: string | null;
  sourceObjectId: string | null;
};

export type RefundFinancialRow = RefundFinancialEvidence & {
  id: string;
  eventKey: string;
  refundId: string;
  providerEventId: string | null;
  createdAt: Date | string;
};

type RefundLike = {
  id?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
  payment_intent?: unknown;
  balance_transaction?: unknown;
  failure_balance_transaction?: unknown;
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

function nullableString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function validateRefundFinancialEvidence(input: {
  refund: RefundLike;
  balanceTransaction: StripeBalanceTransaction;
  kind: RefundFinancialKind;
}) {
  const refundId = typeof input.refund.id === "string" ? input.refund.id : null;
  const refundAmountCents = safeInteger(input.refund.amount);
  const refundCurrency = normalizedCurrency(input.refund.currency);
  const refundStatus = nullableString(input.refund.status);
  const paymentIntentId = objectId(input.refund.payment_intent);
  const linkedBalanceTransactionId = objectId(
    input.kind === "refund_balance"
      ? input.refund.balance_transaction
      : input.refund.failure_balance_transaction,
  );
  const balanceTransactionId = input.balanceTransaction.id;
  const amountCents = safeInteger(input.balanceTransaction.amount);
  const feeCents = safeInteger(input.balanceTransaction.fee);
  const netCents = safeInteger(input.balanceTransaction.net);
  const balanceCurrency = normalizedCurrency(input.balanceTransaction.currency);
  const transactionType = nullableString(input.balanceTransaction.type);
  const reportingCategory = nullableString(input.balanceTransaction.reporting_category);
  const sourceObjectId = objectId(input.balanceTransaction.source);

  if (!refundId || !/^re_[A-Za-z0-9_]+$/.test(refundId)) {
    return { ok: false as const, reason: "REFUND_FINANCIAL_REFUND_ID_INVALID" as const };
  }
  if (refundAmountCents === null || refundAmountCents <= 0 || !refundCurrency) {
    return { ok: false as const, reason: "REFUND_FINANCIAL_REFUND_INVALID" as const };
  }
  if (!linkedBalanceTransactionId || linkedBalanceTransactionId !== balanceTransactionId) {
    return { ok: false as const, reason: "REFUND_FINANCIAL_BALANCE_TRANSACTION_MISMATCH" as const };
  }
  if (!/^txn_[A-Za-z0-9_]+$/.test(balanceTransactionId)) {
    return { ok: false as const, reason: "REFUND_FINANCIAL_BALANCE_TRANSACTION_INVALID" as const };
  }
  if (
    amountCents === null ||
    feeCents === null ||
    feeCents < 0 ||
    netCents === null ||
    netCents !== amountCents - feeCents ||
    !balanceCurrency ||
    !transactionType
  ) {
    return { ok: false as const, reason: "REFUND_FINANCIAL_BALANCE_EVIDENCE_INVALID" as const };
  }

  if (sourceObjectId?.startsWith("re_") && sourceObjectId !== refundId) {
    return { ok: false as const, reason: "REFUND_FINANCIAL_SOURCE_MISMATCH" as const };
  }

  if (input.kind === "refund_balance") {
    if (!["refund", "payment_refund"].includes(transactionType)) {
      return { ok: false as const, reason: "REFUND_FINANCIAL_TRANSACTION_TYPE_INVALID" as const };
    }
    if (amountCents >= 0) {
      return { ok: false as const, reason: "REFUND_FINANCIAL_REFUND_DIRECTION_INVALID" as const };
    }
    if (balanceCurrency === refundCurrency && Math.abs(amountCents) !== refundAmountCents) {
      return { ok: false as const, reason: "REFUND_FINANCIAL_REFUND_AMOUNT_MISMATCH" as const };
    }
  } else {
    if (refundStatus !== "failed") {
      return { ok: false as const, reason: "REFUND_FINANCIAL_FAILURE_STATUS_INVALID" as const };
    }
    if (!["refund_failure", "payment_refund", "adjustment"].includes(transactionType)) {
      return { ok: false as const, reason: "REFUND_FINANCIAL_FAILURE_TYPE_INVALID" as const };
    }
    if (amountCents <= 0) {
      return { ok: false as const, reason: "REFUND_FINANCIAL_FAILURE_DIRECTION_INVALID" as const };
    }
    if (balanceCurrency === refundCurrency && amountCents !== refundAmountCents) {
      return { ok: false as const, reason: "REFUND_FINANCIAL_FAILURE_AMOUNT_MISMATCH" as const };
    }
  }

  return {
    ok: true as const,
    evidence: {
      kind: input.kind,
      providerRefundId: refundId,
      paymentIntentId,
      balanceTransactionId,
      amountCents,
      feeCents,
      netCents,
      currency: balanceCurrency,
      transactionType,
      reportingCategory,
      sourceObjectId,
    } satisfies RefundFinancialEvidence,
  };
}

export function refundFinancialEventKey(evidence: RefundFinancialEvidence) {
  return `refund-financial:${evidence.providerRefundId}:${evidence.kind}:${evidence.balanceTransactionId}`;
}

function deterministicRowId(eventKey: string) {
  const digest = createHash("sha256").update(eventKey).digest("hex").slice(0, 28);
  return `rfe_${digest}`;
}

function normalizedNullable(value: string | null) {
  return value || null;
}

export async function persistRefundFinancialEvidence(
  tx: Prisma.TransactionClient,
  input: {
    refundId: string;
    providerEventId?: string | null;
    evidence: RefundFinancialEvidence;
  },
) {
  const eventKey = refundFinancialEventKey(input.evidence);
  const id = deterministicRowId(eventKey);
  const providerEventId = input.providerEventId || null;

  await tx.$executeRaw(
    Prisma.sql`
      INSERT INTO "RefundFinancialEvent" (
        "id", "eventKey", "refundId", "providerRefundId", "providerEventId",
        "providerBalanceTransactionId", "kind", "amountCents", "feeCents", "netCents",
        "currency", "transactionType", "reportingCategory", "sourceObjectId"
      ) VALUES (
        ${id}, ${eventKey}, ${input.refundId}, ${input.evidence.providerRefundId}, ${providerEventId},
        ${input.evidence.balanceTransactionId}, ${input.evidence.kind}, ${input.evidence.amountCents},
        ${input.evidence.feeCents}, ${input.evidence.netCents}, ${input.evidence.currency},
        ${input.evidence.transactionType}, ${input.evidence.reportingCategory}, ${input.evidence.sourceObjectId}
      )
      ON CONFLICT DO NOTHING
    `,
  );

  const rows = await tx.$queryRaw<RefundFinancialRow[]>(
    Prisma.sql`
      SELECT
        "id", "eventKey", "refundId", "providerRefundId", "providerEventId",
        "providerBalanceTransactionId" AS "balanceTransactionId", "kind",
        "amountCents", "feeCents", "netCents", "currency", "transactionType",
        "reportingCategory", "sourceObjectId", "createdAt"
      FROM "RefundFinancialEvent"
      WHERE "eventKey" = ${eventKey}
         OR "providerBalanceTransactionId" = ${input.evidence.balanceTransactionId}
      ORDER BY "createdAt" ASC
      LIMIT 2
    `,
  );

  if (rows.length !== 1) throw new Error("REFUND_FINANCIAL_EVENT_KEY_CONFLICT");
  const row = rows[0];
  const exact =
    row.eventKey === eventKey &&
    row.refundId === input.refundId &&
    row.providerRefundId === input.evidence.providerRefundId &&
    row.balanceTransactionId === input.evidence.balanceTransactionId &&
    row.kind === input.evidence.kind &&
    row.amountCents === input.evidence.amountCents &&
    row.feeCents === input.evidence.feeCents &&
    row.netCents === input.evidence.netCents &&
    row.currency === input.evidence.currency &&
    row.transactionType === input.evidence.transactionType &&
    normalizedNullable(row.reportingCategory) === normalizedNullable(input.evidence.reportingCategory) &&
    normalizedNullable(row.sourceObjectId) === normalizedNullable(input.evidence.sourceObjectId);

  if (!exact) throw new Error("REFUND_FINANCIAL_IMMUTABLE_MISMATCH");
  return row;
}
