import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  retrieveStripeBalanceTransaction,
  retrieveStripePaymentIntent,
  retrieveStripeRefund,
  type StripeBalanceTransaction,
  type StripeCharge,
  type StripeRefund,
} from "@/lib/stripe-commerce";
import {
  mergeStripeFeeMeta,
  STRIPE_FEE_SOURCE,
  validateStripeFeeEvidence,
} from "@/lib/stripe-fee-reconciliation";
import {
  persistRefundFinancialEvidence,
  validateRefundFinancialEvidence,
  type RefundFinancialEvidence,
  type RefundFinancialKind,
} from "@/lib/refund-financial-reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RefundFinancialCountRow = {
  refundId: string;
  eventCount: bigint;
};

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

async function authorizeAdmin() {
  try {
    await requireAdmin();
    return null;
  } catch (error) {
    const status = error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 403;
    return noStore(
      NextResponse.json({ error: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" }, { status }),
    );
  }
}

function orderSelector(request: Request) {
  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId")?.trim();
  const orderNumber = url.searchParams.get("orderNumber")?.trim();
  return { orderId, orderNumber };
}

async function loadOrder(request: Request) {
  const { orderId, orderNumber } = orderSelector(request);
  if (!orderId && !orderNumber) return { error: "ORDER_IDENTIFIER_REQUIRED" as const, order: null };
  const order = await prisma.order.findFirst({
    where: orderId ? { id: orderId } : { orderNumber },
    include: { payments: true, refunds: true },
  });
  return order
    ? { error: null, order }
    : { error: "ORDER_NOT_FOUND" as const, order: null };
}

function expandedCharge(value: unknown): StripeCharge | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as StripeCharge)
    : null;
}

function expandedBalanceTransaction(value: unknown): StripeBalanceTransaction | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as StripeBalanceTransaction)
    : null;
}

async function balanceTransactionFromValue(value: unknown) {
  const expanded = expandedBalanceTransaction(value);
  if (expanded) return expanded;
  return typeof value === "string" ? retrieveStripeBalanceTransaction(value) : null;
}

async function feeEvidenceForPaymentIntent(paymentIntentId: string) {
  const stripe = await retrieveStripePaymentIntent(paymentIntentId);
  const charge = expandedCharge(stripe.latest_charge);
  if (!charge) return { stripe, charge: null, evidence: null, reason: "STRIPE_CHARGE_NOT_AVAILABLE" as const };

  const balanceTransaction = await balanceTransactionFromValue(charge.balance_transaction);
  if (!balanceTransaction) {
    return { stripe, charge, evidence: null, reason: "STRIPE_BALANCE_TRANSACTION_NOT_AVAILABLE" as const };
  }

  const validated = validateStripeFeeEvidence({
    paymentIntentId,
    charge,
    balanceTransaction,
  });
  if (!validated.ok) throw new Error(validated.reason);
  return { stripe, charge, evidence: validated.evidence, reason: null };
}

async function refundEvidenceForStripeRefund(stripeRefund: StripeRefund) {
  const evidence: RefundFinancialEvidence[] = [];
  const candidates: Array<{ kind: RefundFinancialKind; value: unknown }> = [
    { kind: "refund_balance", value: stripeRefund.balance_transaction },
    { kind: "refund_failure_balance", value: stripeRefund.failure_balance_transaction },
  ];
  for (const candidate of candidates) {
    if (!candidate.value) continue;
    const balanceTransaction = await balanceTransactionFromValue(candidate.value);
    if (!balanceTransaction) continue;
    const validated = validateRefundFinancialEvidence({
      refund: stripeRefund,
      balanceTransaction,
      kind: candidate.kind,
    });
    if (!validated.ok) throw new Error(validated.reason);
    evidence.push(validated.evidence);
  }
  return evidence;
}

async function localRefundFinancialCounts(refundIds: string[]) {
  if (refundIds.length === 0) return new Map<string, number>();
  const rows = await prisma.$queryRaw<RefundFinancialCountRow[]>(
    Prisma.sql`
      SELECT "refundId", COUNT(*) AS "eventCount"
      FROM "RefundFinancialEvent"
      WHERE "refundId" IN (${Prisma.join(refundIds)})
      GROUP BY "refundId"
    `,
  );
  return new Map(rows.map((row) => [row.refundId, Number(row.eventCount)]));
}

export async function GET(request: Request) {
  const auth = await authorizeAdmin();
  if (auth) return auth;

  const loaded = await loadOrder(request);
  if (loaded.error === "ORDER_IDENTIFIER_REQUIRED") {
    return noStore(NextResponse.json({ error: loaded.error }, { status: 400 }));
  }
  if (!loaded.order) return noStore(NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 }));
  const order = loaded.order;
  if (!order.stripePaymentIntentId) {
    return noStore(
      NextResponse.json(
        {
          reconciled: false,
          orderNumber: order.orderNumber,
          reason: "NO_STRIPE_PAYMENT_INTENT",
          localStatus: order.status,
        },
        { status: 409 },
      ),
    );
  }

  try {
    const feeLookup = await feeEvidenceForPaymentIntent(order.stripePaymentIntentId);
    const stripe = feeLookup.stripe;
    const charge = feeLookup.charge;
    const stripeRefundedCents = charge?.amount_refunded || 0;
    const ledgerRefundedCents = order.refunds
      .filter((refund) => refund.status === "succeeded")
      .reduce((sum, refund) => sum + refund.amountCents, 0);
    const localPayment = order.payments.find(
      (payment) => payment.providerPaymentId === order.stripePaymentIntentId,
    );
    const refundFinancialCounts = await localRefundFinancialCounts(order.refunds.map((refund) => refund.id));
    const succeededRefundsWithFinancialEvidence = order.refunds.filter(
      (refund) => refund.status === "succeeded" && (refundFinancialCounts.get(refund.id) || 0) > 0,
    ).length;
    const succeededRefundCount = order.refunds.filter((refund) => refund.status === "succeeded").length;

    const checks = {
      paymentIntentId: stripe.id === order.stripePaymentIntentId,
      currency: stripe.currency.toLowerCase() === order.currency.toLowerCase(),
      amount: stripe.amount === order.totalCents,
      paymentStatus:
        stripe.status === "succeeded"
          ? order.status === "paid" || order.status === "partially_refunded" || order.status === "refunded"
          : localPayment?.status === stripe.status,
      paymentLedger: stripe.status !== "succeeded" || localPayment?.status === "succeeded",
      refunds: stripeRefundedCents === ledgerRefundedCents,
      feeEvidenceAvailable: feeLookup.evidence !== null,
      refundFinancialEvidence:
        succeededRefundsWithFinancialEvidence === succeededRefundCount,
    };
    const mismatches = Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name);

    return noStore(NextResponse.json({
      reconciled: mismatches.length === 0,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        totalCents: order.totalCents,
        currency: order.currency,
        paymentIntentId: order.stripePaymentIntentId,
        succeededRefundCents: ledgerRefundedCents,
        succeededRefundCount,
        succeededRefundsWithFinancialEvidence,
      },
      stripe: {
        paymentIntentId: stripe.id,
        status: stripe.status,
        amountCents: stripe.amount,
        amountReceivedCents: stripe.amount_received || 0,
        currency: stripe.currency,
        refundedCents: stripeRefundedCents,
        feeEvidence: feeLookup.evidence,
        feeEvidenceReason: feeLookup.reason,
      },
      checks,
      mismatches,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    console.error("finance.reconcile.failed", { orderId: order.id, error: message });
    return noStore(NextResponse.json({ error: "STRIPE_RECONCILIATION_UNAVAILABLE" }, { status: 502 }));
  }
}

export async function POST(request: Request) {
  const auth = await authorizeAdmin();
  if (auth) return auth;

  const loaded = await loadOrder(request);
  if (loaded.error === "ORDER_IDENTIFIER_REQUIRED") {
    return noStore(NextResponse.json({ error: loaded.error }, { status: 400 }));
  }
  if (!loaded.order) return noStore(NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 }));
  const order = loaded.order;
  if (!order.stripePaymentIntentId) {
    return noStore(NextResponse.json({ error: "NO_STRIPE_PAYMENT_INTENT" }, { status: 409 }));
  }

  try {
    const lookup = await feeEvidenceForPaymentIntent(order.stripePaymentIntentId);
    if (!lookup.evidence) {
      return noStore(
        NextResponse.json(
          { reconciled: false, reason: lookup.reason || "STRIPE_FEE_EVIDENCE_UNAVAILABLE" },
          { status: 409 },
        ),
      );
    }
    const evidence = lookup.evidence;

    const refundLookups = await Promise.all(
      order.refunds.map(async (refund) => {
        const stripeRefund = await retrieveStripeRefund(refund.providerRefundId);
        const financialEvidence = await refundEvidenceForStripeRefund(stripeRefund);
        return { local: refund, stripe: stripeRefund, financialEvidence };
      }),
    );

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { providerPaymentId: order.stripePaymentIntentId! },
      });
      if (!payment) throw new Error("FEE_RECONCILIATION_PAYMENT_NOT_FOUND");
      if (payment.status !== "succeeded") throw new Error("FEE_RECONCILIATION_PAYMENT_NOT_SUCCEEDED");
      if (
        payment.orderId !== order.id ||
        payment.amountCents !== evidence.chargeAmountCents ||
        payment.currency.toLowerCase() !== evidence.chargeCurrency ||
        order.totalCents !== evidence.chargeAmountCents ||
        order.currency.toLowerCase() !== evidence.chargeCurrency
      ) {
        throw new Error("FEE_RECONCILIATION_PAYMENT_MISMATCH");
      }

      const merged = mergeStripeFeeMeta({
        currentMeta: payment.meta,
        evidence,
        source: STRIPE_FEE_SOURCE,
        reconciledAt: new Date().toISOString(),
      });
      if (!merged.ok) throw new Error(merged.reason);

      const updated = await tx.payment.updateMany({
        where: { id: payment.id, updatedAt: payment.updatedAt },
        data: { meta: merged.meta },
      });
      if (updated.count !== 1) throw new Error("FEE_RECONCILIATION_CONCURRENT_CHANGE");

      let refundFinancialEventsRecorded = 0;
      for (const lookupRefund of refundLookups) {
        const local = await tx.refund.findUnique({ where: { id: lookupRefund.local.id } });
        if (!local) throw new Error("REFUND_FINANCIAL_LOCAL_REFUND_NOT_FOUND");
        const stripeStatus = lookupRefund.stripe.status || "unknown";
        const stripePaymentIntentId = lookupRefund.stripe.payment_intent || null;
        if (
          local.updatedAt.getTime() !== lookupRefund.local.updatedAt.getTime() ||
          local.providerRefundId !== lookupRefund.stripe.id ||
          local.status !== stripeStatus ||
          local.amountCents !== lookupRefund.stripe.amount ||
          local.currency.toLowerCase() !== lookupRefund.stripe.currency.toLowerCase() ||
          (stripePaymentIntentId !== null && stripePaymentIntentId !== order.stripePaymentIntentId)
        ) {
          throw new Error("REFUND_FINANCIAL_LEDGER_MISMATCH");
        }
        for (const refundEvidence of lookupRefund.financialEvidence) {
          await persistRefundFinancialEvidence(tx, {
            refundId: local.id,
            evidence: refundEvidence,
          });
          refundFinancialEventsRecorded += 1;
        }
      }

      return { paymentId: payment.id, evidence, refundFinancialEventsRecorded };
    });

    return noStore(NextResponse.json({
      reconciled: true,
      automaticSupplierPurchasingEnabled: false,
      paymentId: result.paymentId,
      fee: result.evidence,
      refundFinancialEventsRecorded: result.refundFinancialEventsRecorded,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    const conflicts = new Set([
      "FEE_RECONCILIATION_PAYMENT_NOT_FOUND",
      "FEE_RECONCILIATION_PAYMENT_NOT_SUCCEEDED",
      "FEE_RECONCILIATION_PAYMENT_MISMATCH",
      "FEE_RECONCILIATION_CONCURRENT_CHANGE",
      "STRIPE_FEE_IMMUTABLE_MISMATCH",
      "REFUND_FINANCIAL_LOCAL_REFUND_NOT_FOUND",
      "REFUND_FINANCIAL_LEDGER_MISMATCH",
      "REFUND_FINANCIAL_EVENT_KEY_CONFLICT",
      "REFUND_FINANCIAL_IMMUTABLE_MISMATCH",
    ]);
    if (conflicts.has(message)) {
      return noStore(NextResponse.json({ error: message }, { status: 409 }));
    }
    console.error("finance.fee_reconcile.failed", { orderId: order.id, error: message });
    return noStore(NextResponse.json({ error: "STRIPE_FEE_RECONCILIATION_UNAVAILABLE" }, { status: 502 }));
  }
}
