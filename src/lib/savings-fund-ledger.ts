import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  calculateSavingsFundAccrual,
  currentSavingsFundPolicy,
  SAVINGS_FUND_POLICY_VERSION,
} from "@/lib/customer-savings-fund";

export type SavingsFundLedgerEntry = {
  id: string;
  entryKey: string;
  type: string;
  orderId: string | null;
  refundId: string | null;
  amountCents: number;
  currency: string;
  sourceProfitCents: number | null;
  policyVersion: string;
  dryRun: boolean;
  metadata: string;
  createdAt: Date | string;
};

type SumRow = { balance: bigint | number | string | null };
type OrderStateRow = SumRow & { entryCount: bigint | number | string | null };
type CurrencyRow = { currency: string };

function normalizeCurrency(value: string) {
  const currency = value.trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) throw new Error("SAVINGS_FUND_CURRENCY_INVALID");
  return currency;
}

function safeInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value)) throw new Error(`${field.toUpperCase()}_INVALID`);
  return value;
}

function dbInteger(value: bigint | number | string | null | undefined, field: string) {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${field.toUpperCase()}_INVALID`);
  return parsed;
}

export async function getShadowSavingsFundBalance(currencyInput: string) {
  const currency = normalizeCurrency(currencyInput);
  try {
    const rows = await prisma.$queryRaw<SumRow[]>(Prisma.sql`
      SELECT COALESCE(SUM("amountCents"), 0) AS "balance"
      FROM "SavingsFundEntry"
      WHERE "currency" = ${currency}
        AND "dryRun" = TRUE
        AND "policyVersion" = ${SAVINGS_FUND_POLICY_VERSION}
    `);
    const balanceCents = dbInteger(rows[0]?.balance, "savings_fund_balance");
    if (balanceCents < 0) {
      return { available: true, integrityOk: false, currency, balanceCents: 0 } as const;
    }
    return { available: true, integrityOk: true, currency, balanceCents } as const;
  } catch (error) {
    console.warn("savings_fund.shadow_balance.unavailable", {
      currency,
      error: error instanceof Error ? error.message : "UNKNOWN",
    });
    // Phase A callers fail closed if the ledger migration has not reached an
    // environment yet; no real customer price depends on this shadow balance.
    return { available: false, integrityOk: false, currency, balanceCents: 0 } as const;
  }
}

async function shadowOrderState(orderId: string, policyVersion: string) {
  const rows = await prisma.$queryRaw<OrderStateRow[]>(Prisma.sql`
    SELECT
      COALESCE(SUM("amountCents"), 0) AS "balance",
      COUNT(*) AS "entryCount"
    FROM "SavingsFundEntry"
    WHERE "orderId" = ${orderId}
      AND "dryRun" = TRUE
      AND "policyVersion" = ${policyVersion}
  `);
  return {
    balanceCents: dbInteger(rows[0]?.balance, "savings_fund_order_balance"),
    entryCount: dbInteger(rows[0]?.entryCount, "savings_fund_order_entry_count"),
  };
}

async function shadowOrderCurrencies(orderId: string, policyVersion: string) {
  return prisma.$queryRaw<CurrencyRow[]>(Prisma.sql`
    SELECT DISTINCT "currency"
    FROM "SavingsFundEntry"
    WHERE "orderId" = ${orderId}
      AND "dryRun" = TRUE
      AND "policyVersion" = ${policyVersion}
  `);
}

/**
 * Reconciles one order to its current certified-profit target by appending a
 * new delta entry. Existing ledger rows are never updated or deleted.
 *
 * The entry key is a per-order revision number. Concurrent reconcilers that
 * observe the same state therefore compete for the same unique revision key;
 * only one can append. A loser verifies the resulting balance and either
 * accepts the already-correct state or fails closed for a retry.
 */
export async function reconcileShadowSavingsFundOrder(input: {
  orderId: string;
  currency: string;
  certified: boolean;
  certifiedContributionCents: number | null;
  reason?: string | null;
}) {
  const orderId = input.orderId.trim();
  if (!orderId || orderId.length > 128) throw new Error("SAVINGS_FUND_ORDER_ID_INVALID");
  const currency = normalizeCurrency(input.currency);
  const policy = currentSavingsFundPolicy();
  if (policy.mode !== "dry_run" || policy.appliesToCheckout) {
    throw new Error("SAVINGS_FUND_PHASE_A_INVARIANT_FAILED");
  }

  const sourceProfitCents = input.certified && input.certifiedContributionCents !== null
    ? safeInteger(input.certifiedContributionCents, "certified_contribution_cents")
    : null;
  const targetAccrualCents = sourceProfitCents !== null && sourceProfitCents > 0
    ? calculateSavingsFundAccrual(sourceProfitCents, policy.profitReinvestmentBps)
    : 0;

  const currencies = await shadowOrderCurrencies(orderId, policy.version);
  if (currencies.some((row) => row.currency.toLowerCase() !== currency)) {
    throw new Error("SAVINGS_FUND_ORDER_CURRENCY_MISMATCH");
  }

  const before = await shadowOrderState(orderId, policy.version);
  const deltaCents = targetAccrualCents - before.balanceCents;
  if (deltaCents === 0) {
    return {
      changed: false,
      policyVersion: policy.version,
      orderId,
      currency,
      targetAccrualCents,
      previousAccrualCents: before.balanceCents,
      deltaCents: 0,
      revision: before.entryCount,
      dryRun: true,
    } as const;
  }

  const type = deltaCents > 0 ? "accrual" : "reversal";
  const nextRevision = before.entryCount + 1;
  const entryKey = `${policy.version}:order:${orderId}:revision:${nextRevision}`;
  const metadata = JSON.stringify({
    phase: "A",
    measureOnly: true,
    reason: input.reason || (input.certified ? "certified_order_contribution" : "order_not_certified"),
    reinvestmentBps: policy.profitReinvestmentBps,
    previousAccrualCents: before.balanceCents,
    targetAccrualCents,
    revision: nextRevision,
  });

  const inserted = await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "SavingsFundEntry" (
      "id", "entryKey", "type", "orderId", "refundId", "amountCents", "currency",
      "sourceProfitCents", "policyVersion", "dryRun", "metadata", "createdAt"
    ) VALUES (
      ${`sf_${randomUUID().replaceAll("-", "")}`},
      ${entryKey},
      ${type},
      ${orderId},
      ${null},
      ${deltaCents},
      ${currency},
      ${sourceProfitCents},
      ${policy.version},
      TRUE,
      ${metadata},
      CURRENT_TIMESTAMP
    )
    ON CONFLICT("entryKey") DO NOTHING
  `);

  const after = await shadowOrderState(orderId, policy.version);
  if (after.balanceCents !== targetAccrualCents) {
    throw new Error("SAVINGS_FUND_RECONCILIATION_CONCURRENT_CHANGE");
  }

  return {
    changed: inserted === 1,
    policyVersion: policy.version,
    orderId,
    currency,
    targetAccrualCents,
    previousAccrualCents: before.balanceCents,
    deltaCents: inserted === 1 ? deltaCents : 0,
    revision: after.entryCount,
    dryRun: true,
  } as const;
}

export async function listRecentShadowSavingsFundEntries(limit = 50) {
  const safeLimit = Math.min(200, Math.max(1, Math.floor(limit)));
  return prisma.$queryRaw<SavingsFundLedgerEntry[]>(Prisma.sql`
    SELECT
      "id", "entryKey", "type", "orderId", "refundId", "amountCents", "currency",
      "sourceProfitCents", "policyVersion", "dryRun", "metadata", "createdAt"
    FROM "SavingsFundEntry"
    WHERE "dryRun" = TRUE
      AND "policyVersion" = ${SAVINGS_FUND_POLICY_VERSION}
    ORDER BY "createdAt" DESC
    LIMIT ${safeLimit}
  `);
}
