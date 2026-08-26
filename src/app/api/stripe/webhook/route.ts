import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { persistCheckoutOrderDestination } from "@/lib/order-destination";
import { ensureProcurementIntentsForPaidOrder } from "@/lib/procurement-intents";
import {
  assertStripeEventMode,
  expectedStripeLivemode,
  isExactWebhookReplay,
  payloadSha256,
  retrieveStripeBalanceTransaction,
  stripeAutomaticTaxEnabled,
  stripeWebhookSecret,
  verifyStripeSignature,
  type StripeBalanceTransaction,
  type StripeEvent,
} from "@/lib/stripe-commerce";
import {
  deriveFinancialOrderStatus,
  mergeStripeDisputeMeta,
  type StripeDisputeEventType,
} from "@/lib/stripe-dispute-integrity";
import { resolveStripeCheckoutTaxAuthority } from "@/lib/stripe-tax-authority";
import {
  mergeStripeFeeMeta,
  STRIPE_FEE_WEBHOOK_SOURCE,
  validateStripeFeeEvidence,
  type StripeFeeEvidence,
} from "@/lib/stripe-fee-reconciliation";
import {
  persistRefundFinancialEvidence,
  validateRefundFinancialEvidence,
  type RefundFinancialEvidence,
  type RefundFinancialKind,
} from "@/lib/refund-financial-reconciliation";

export const runtime = "nodejs";

const MAX_WEBHOOK_BYTES = 1024 * 1024;
const PAYMENT_FAILURE_PROTECTED_ORDER_STATUSES = new Set([
  "paid",
  "partially_refunded",
  "refunded",
  "payment_disputed",
  "payment_dispute_lost",
]);

class DuplicateStripeEventError extends Error {
  constructor() {
    super("DUPLICATE_STRIPE_EVENT");
    this.name = "DuplicateStripeEventError";
  }
}

function asString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function objectId(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return asString((value as Record<string, unknown>).id);
  }
  return null;
}

function metadataOf(object: Record<string, unknown>) {
  const metadata = object.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {} as Record<string, string>;
  }
  return Object.fromEntries(
    Object.entries(metadata).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function paymentIntentId(object: Record<string, unknown>) {
  return objectId(object.payment_intent);
}

function eventObjectPaymentIntentId(object: Record<string, unknown>) {
  const relatedIntent = paymentIntentId(object);
  if (relatedIntent) return relatedIntent;
  const objectIdValue = asString(object.id);
  return objectIdValue?.startsWith("pi_") ? objectIdValue : null;
}

async function assertPaymentIntentOrderBinding(
  tx: Prisma.TransactionClient,
  orderId: string,
  intentId: string | null,
) {
  if (!intentId) return;
  const payment = await tx.payment.findUnique({
    where: { providerPaymentId: intentId },
    select: { orderId: true },
  });
  if (payment && payment.orderId !== orderId) {
    throw new Error("WEBHOOK_PAYMENT_ORDER_MISMATCH");
  }
}

async function resolveOrderId(
  tx: Prisma.TransactionClient,
  object: Record<string, unknown>,
) {
  const metadata = metadataOf(object);
  const metadataOrderId = metadata.order_id || null;
  const clientReferenceId = asString(object.client_reference_id);
  const intentId = eventObjectPaymentIntentId(object);

  if (metadataOrderId && clientReferenceId && metadataOrderId !== clientReferenceId) {
    throw new Error("WEBHOOK_ORDER_REFERENCE_MISMATCH");
  }

  if (metadataOrderId) {
    await assertPaymentIntentOrderBinding(tx, metadataOrderId, intentId);
    return metadataOrderId;
  }
  if (clientReferenceId) {
    await assertPaymentIntentOrderBinding(tx, clientReferenceId, intentId);
    return clientReferenceId;
  }
  if (intentId) {
    const order = await tx.order.findUnique({
      where: { stripePaymentIntentId: intentId },
      select: { id: true },
    });
    return order?.id || null;
  }
  return null;
}

async function reconcileCheckoutTaxAuthority(
  tx: Prisma.TransactionClient,
  orderId: string,
  object: Record<string, unknown>,
) {
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error("WEBHOOK_ORDER_NOT_FOUND");

  const totals = resolveStripeCheckoutTaxAuthority(order, object);
  if (!totals.automaticTaxEnabled) return order;

  // A verified Checkout event is the only path allowed to replace provisional
  // pre-tax totals. Merchandise subtotal and configured shipping remain locked;
  // only Stripe's completed automatic-tax amount and resulting grand total move.
  return tx.order.update({
    where: { id: orderId },
    data: {
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
    },
  });
}

async function assertPaymentMatchesOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  object: Record<string, unknown>,
) {
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error("WEBHOOK_ORDER_NOT_FOUND");

  const intentId = eventObjectPaymentIntentId(object);
  await assertPaymentIntentOrderBinding(tx, orderId, intentId);

  const amount = asInteger(object.amount_total) ?? asInteger(object.amount_received) ?? asInteger(object.amount);
  const currency = asString(object.currency)?.toLowerCase();
  if (amount !== null && amount !== order.totalCents) throw new Error("WEBHOOK_AMOUNT_MISMATCH");
  if (currency && currency !== order.currency.toLowerCase()) throw new Error("WEBHOOK_CURRENCY_MISMATCH");
  return order;
}

async function deriveOrderFinancialStatus(
  tx: Prisma.TransactionClient,
  order: { id: string; totalCents: number },
  paymentMeta: string,
) {
  const totals = await tx.refund.aggregate({
    where: { orderId: order.id, status: "succeeded" },
    _sum: { amountCents: true },
  });
  const succeededRefundCents = totals._sum.amountCents || 0;
  if (succeededRefundCents > order.totalCents) throw new Error("REFUND_LEDGER_OVERFLOW");

  const financial = deriveFinancialOrderStatus({
    paymentMeta,
    succeededRefundCents,
    totalCents: order.totalCents,
  });
  if (!financial.ok) throw new Error(financial.reason);
  return financial;
}

async function markPaymentSucceeded(
  tx: Prisma.TransactionClient,
  orderId: string,
  object: Record<string, unknown>,
) {
  const order = await assertPaymentMatchesOrder(tx, orderId, object);
  const intentId = eventObjectPaymentIntentId(object);
  if (!intentId) throw new Error("WEBHOOK_PAYMENT_INTENT_MISSING");

  const objectIdValue = asString(object.id);
  const sessionId = objectIdValue?.startsWith("cs_") ? objectIdValue : null;
  if (sessionId && order.stripeCheckoutSessionId && order.stripeCheckoutSessionId !== sessionId) {
    throw new Error("WEBHOOK_CHECKOUT_SESSION_MISMATCH");
  }
  if (order.stripePaymentIntentId && order.stripePaymentIntentId !== intentId) {
    throw new Error("WEBHOOK_PAYMENT_INTENT_MISMATCH");
  }

  const payment = await tx.payment.upsert({
    where: { providerPaymentId: intentId },
    create: {
      orderId,
      providerPaymentId: intentId,
      providerSessionId: sessionId || order.stripeCheckoutSessionId,
      status: "succeeded",
      amountCents: order.totalCents,
      currency: order.currency,
      meta: JSON.stringify({ source: "stripe_webhook" }),
    },
    update: {
      status: "succeeded",
      providerSessionId: sessionId || order.stripeCheckoutSessionId,
      amountCents: order.totalCents,
      currency: order.currency,
    },
  });

  const financial = await deriveOrderFinancialStatus(tx, order, payment.meta);
  const updated = await tx.order.updateMany({
    where: { id: orderId, updatedAt: order.updatedAt },
    data: {
      status: financial.status,
      stripeCheckoutSessionId: sessionId || order.stripeCheckoutSessionId,
      stripePaymentIntentId: intentId,
      paidAt: order.paidAt || new Date(),
    },
  });
  if (updated.count !== 1) throw new Error("WEBHOOK_PAYMENT_CONCURRENT_ORDER_CHANGE");
  return financial;
}

async function markPaymentFailed(
  tx: Prisma.TransactionClient,
  orderId: string,
  object: Record<string, unknown>,
) {
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order || PAYMENT_FAILURE_PROTECTED_ORDER_STATUSES.has(order.status)) return;
  const intentId = eventObjectPaymentIntentId(object);
  await assertPaymentIntentOrderBinding(tx, orderId, intentId);

  if (intentId) {
    await tx.payment.upsert({
      where: { providerPaymentId: intentId },
      create: {
        orderId,
        providerPaymentId: intentId,
        providerSessionId: order.stripeCheckoutSessionId,
        status: "failed",
        amountCents: order.totalCents,
        currency: order.currency,
      },
      update: { status: "failed" },
    });
  }
  const updated = await tx.order.updateMany({
    where: { id: orderId, updatedAt: order.updatedAt },
    data: { status: "payment_failed" },
  });
  if (updated.count !== 1) throw new Error("WEBHOOK_PAYMENT_CONCURRENT_ORDER_CHANGE");
}

async function reconcileRefund(
  tx: Prisma.TransactionClient,
  object: Record<string, unknown>,
) {
  const refundId = asString(object.id);
  const intentId = paymentIntentId(object);
  const amountCents = asInteger(object.amount);
  const currency = asString(object.currency)?.toLowerCase();
  const status = asString(object.status) || "unknown";
  if (!refundId || !intentId || !amountCents || amountCents <= 0 || !currency) {
    throw new Error("WEBHOOK_REFUND_INVALID");
  }

  const metadata = metadataOf(object);
  const payment = await tx.payment.findUnique({ where: { providerPaymentId: intentId } });
  if (!payment) throw new Error("WEBHOOK_REFUND_PAYMENT_NOT_FOUND");

  const order = metadata.order_id
    ? await tx.order.findUnique({ where: { id: metadata.order_id } })
    : await tx.order.findUnique({ where: { id: payment.orderId } });
  if (!order) throw new Error("WEBHOOK_REFUND_ORDER_NOT_FOUND");
  if (payment.orderId !== order.id) throw new Error("WEBHOOK_REFUND_ORDER_MISMATCH");
  if (order.stripePaymentIntentId && order.stripePaymentIntentId !== intentId) {
    throw new Error("WEBHOOK_REFUND_PAYMENT_INTENT_MISMATCH");
  }
  if (order.currency.toLowerCase() !== currency) throw new Error("WEBHOOK_REFUND_CURRENCY_MISMATCH");
  if (amountCents > order.totalCents) throw new Error("WEBHOOK_REFUND_AMOUNT_INVALID");

  const existingRefund = await tx.refund.findUnique({
    where: { providerRefundId: refundId },
    select: { orderId: true, paymentId: true, amountCents: true, currency: true },
  });
  if (existingRefund) {
    if (existingRefund.orderId !== order.id || existingRefund.paymentId !== payment.id) {
      throw new Error("WEBHOOK_REFUND_ORDER_MISMATCH");
    }
    if (
      existingRefund.amountCents !== amountCents ||
      existingRefund.currency.toLowerCase() !== currency
    ) {
      throw new Error("WEBHOOK_REFUND_IMMUTABLE_FIELD_MISMATCH");
    }
  }

  const savedRefund = await tx.refund.upsert({
    where: { providerRefundId: refundId },
    create: {
      orderId: order.id,
      paymentId: payment.id,
      providerRefundId: refundId,
      idempotencyKey: `stripe-refund:${refundId}`,
      amountCents,
      currency,
      status,
      reason: asString(object.reason),
      requestedBy: "stripe",
    },
    update: {
      status,
      reason: asString(object.reason),
    },
  });

  const financial = await deriveOrderFinancialStatus(tx, order, payment.meta);
  const updated = await tx.order.updateMany({
    where: { id: order.id, updatedAt: order.updatedAt },
    data: { status: financial.status },
  });
  if (updated.count !== 1) throw new Error("WEBHOOK_REFUND_CONCURRENT_ORDER_CHANGE");
  return { orderId: order.id, refundId: savedRefund.id };
}

async function prepareStripeFeeEvidence(event: StripeEvent): Promise<StripeFeeEvidence | null> {
  if (!["charge.succeeded", "charge.updated"].includes(event.type)) return null;
  const object = event.data.object;
  const status = asString(object.status);
  if (status && status !== "succeeded") return null;

  const intentId = paymentIntentId(object);
  const balanceTransactionId = objectId(object.balance_transaction);
  if (!intentId || !balanceTransactionId) return null;

  const balanceTransaction = await retrieveStripeBalanceTransaction(balanceTransactionId);
  const validated = validateStripeFeeEvidence({
    paymentIntentId: intentId,
    charge: object,
    balanceTransaction,
  });
  if (!validated.ok) throw new Error(validated.reason);
  return validated.evidence;
}

async function balanceTransactionFromValue(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") {
    return retrieveStripeBalanceTransaction(value);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const transaction = value as StripeBalanceTransaction;
    if (!transaction.id) return null;
    return transaction;
  }
  return null;
}

async function prepareRefundFinancialEvidence(event: StripeEvent): Promise<RefundFinancialEvidence[]> {
  if (!["refund.created", "refund.updated", "refund.failed"].includes(event.type)) return [];
  const object = event.data.object;
  const evidence: RefundFinancialEvidence[] = [];

  const candidates: Array<{ kind: RefundFinancialKind; value: unknown }> = [
    { kind: "refund_balance", value: object.balance_transaction },
    { kind: "refund_failure_balance", value: object.failure_balance_transaction },
  ];

  for (const candidate of candidates) {
    if (!candidate.value) continue;
    const balanceTransaction = await balanceTransactionFromValue(candidate.value);
    if (!balanceTransaction) continue;
    const validated = validateRefundFinancialEvidence({
      refund: object,
      balanceTransaction,
      kind: candidate.kind,
    });
    if (!validated.ok) throw new Error(validated.reason);
    evidence.push(validated.evidence);
  }

  return evidence;
}

async function reconcilePaymentFee(
  tx: Prisma.TransactionClient,
  evidence: StripeFeeEvidence,
  eventId: string,
) {
  const payment = await tx.payment.findUnique({
    where: { providerPaymentId: evidence.paymentIntentId },
  });
  if (!payment) throw new Error("WEBHOOK_FEE_PAYMENT_NOT_FOUND");
  if (payment.status !== "succeeded") throw new Error("WEBHOOK_FEE_PAYMENT_NOT_SUCCEEDED");
  if (
    payment.amountCents !== evidence.chargeAmountCents ||
    payment.currency.toLowerCase() !== evidence.chargeCurrency
  ) {
    throw new Error("WEBHOOK_FEE_PAYMENT_MISMATCH");
  }

  const order = await tx.order.findUnique({ where: { id: payment.orderId } });
  if (!order) throw new Error("WEBHOOK_FEE_ORDER_NOT_FOUND");
  if (
    order.stripePaymentIntentId !== evidence.paymentIntentId ||
    order.totalCents !== evidence.chargeAmountCents ||
    order.currency.toLowerCase() !== evidence.chargeCurrency
  ) {
    throw new Error("WEBHOOK_FEE_ORDER_MISMATCH");
  }

  const merged = mergeStripeFeeMeta({
    currentMeta: payment.meta,
    evidence,
    source: STRIPE_FEE_WEBHOOK_SOURCE,
    reconciledAt: new Date().toISOString(),
    eventId,
  });
  if (!merged.ok) throw new Error(merged.reason);

  const updated = await tx.payment.updateMany({
    where: { id: payment.id, updatedAt: payment.updatedAt },
    data: { meta: merged.meta },
  });
  if (updated.count !== 1) throw new Error("WEBHOOK_FEE_CONCURRENT_PAYMENT_CHANGE");
  return order.id;
}

async function reconcileDispute(
  tx: Prisma.TransactionClient,
  event: StripeEvent,
) {
  const object = event.data.object;
  const disputeId = asString(object.id);
  const intentId = paymentIntentId(object);
  const chargeId = objectId(object.charge);
  const amountCents = asInteger(object.amount);
  const currency = asString(object.currency)?.toLowerCase();
  const status = asString(object.status);
  const reason = asString(object.reason);
  const eventCreated = asInteger(event.created);

  if (
    !disputeId ||
    !intentId ||
    !chargeId ||
    !amountCents ||
    amountCents <= 0 ||
    !currency ||
    !status ||
    !eventCreated ||
    eventCreated <= 0
  ) {
    throw new Error("WEBHOOK_DISPUTE_INVALID");
  }

  const payment = await tx.payment.findUnique({ where: { providerPaymentId: intentId } });
  if (!payment) throw new Error("WEBHOOK_DISPUTE_PAYMENT_NOT_FOUND");
  if (payment.status !== "succeeded") throw new Error("WEBHOOK_DISPUTE_PAYMENT_NOT_SUCCEEDED");
  if (
    payment.currency.toLowerCase() !== currency ||
    amountCents > payment.amountCents
  ) {
    throw new Error("WEBHOOK_DISPUTE_PAYMENT_MISMATCH");
  }

  const order = await tx.order.findUnique({ where: { id: payment.orderId } });
  if (!order) throw new Error("WEBHOOK_DISPUTE_ORDER_NOT_FOUND");
  if (
    order.stripePaymentIntentId !== intentId ||
    order.currency.toLowerCase() !== currency ||
    amountCents > order.totalCents
  ) {
    throw new Error("WEBHOOK_DISPUTE_ORDER_MISMATCH");
  }

  const merged = mergeStripeDisputeMeta({
    currentMeta: payment.meta,
    dispute: {
      disputeId,
      paymentIntentId: intentId,
      chargeId,
      amountCents,
      currency,
      status,
      reason,
    },
    eventId: event.id,
    eventType: event.type as StripeDisputeEventType,
    eventCreated,
    reconciledAt: new Date().toISOString(),
  });
  if (!merged.ok) throw new Error(merged.reason);

  if (!merged.stale) {
    const paymentUpdated = await tx.payment.updateMany({
      where: { id: payment.id, updatedAt: payment.updatedAt },
      data: { meta: merged.meta },
    });
    if (paymentUpdated.count !== 1) {
      throw new Error("WEBHOOK_DISPUTE_CONCURRENT_PAYMENT_CHANGE");
    }
  }

  const financial = await deriveOrderFinancialStatus(tx, order, merged.meta);
  const orderUpdated = await tx.order.updateMany({
    where: { id: order.id, updatedAt: order.updatedAt },
    data: { status: financial.status },
  });
  if (orderUpdated.count !== 1) {
    throw new Error("WEBHOOK_DISPUTE_CONCURRENT_ORDER_CHANGE");
  }

  await tx.systemLog.create({
    data: {
      level: financial.disposition === "lost" ? "error" : financial.disposition === "active" ? "warn" : "info",
      source: "stripe_dispute",
      message:
        financial.disposition === "lost"
          ? "Stripe dispute lost; procurement remains blocked"
          : financial.disposition === "active"
            ? "Stripe dispute active; procurement blocked"
            : "Stripe dispute resolved; financial state reconciled",
      meta: JSON.stringify({
        eventId: event.id,
        eventType: event.type,
        disputeId,
        paymentIntentId: intentId,
        chargeId,
        orderId: order.id,
        amountCents,
        currency,
        status,
        reason,
        stale: merged.stale,
        financialOrderStatus: financial.status,
        activeDisputeIds: financial.activeDisputeIds,
        lostDisputeIds: financial.lostDisputeIds,
        automaticSupplierPurchasingEnabled: false,
      }),
    },
  });

  return order.id;
}

async function processStripeEvent(
  tx: Prisma.TransactionClient,
  event: StripeEvent,
  feeEvidence: StripeFeeEvidence | null,
  refundFinancialEvidence: RefundFinancialEvidence[],
) {
  const object = event.data.object;
  let orderId = await resolveOrderId(tx, object);

  switch (event.type) {
    case "checkout.session.completed":
      if (!orderId) throw new Error("WEBHOOK_ORDER_ID_MISSING");
      await persistCheckoutOrderDestination(tx, {
        orderId,
        sourceEventId: event.id,
        object,
      });
      await reconcileCheckoutTaxAuthority(tx, orderId, object);
      if (asString(object.payment_status) === "paid") {
        const financial = await markPaymentSucceeded(tx, orderId, object);
        if (financial.status === "paid") {
          await ensureProcurementIntentsForPaidOrder(tx, orderId);
        }
      }
      break;
    case "checkout.session.async_payment_succeeded":
      if (!orderId) throw new Error("WEBHOOK_ORDER_ID_MISSING");
      await persistCheckoutOrderDestination(tx, {
        orderId,
        sourceEventId: event.id,
        object,
      });
      await reconcileCheckoutTaxAuthority(tx, orderId, object);
      {
        const financial = await markPaymentSucceeded(tx, orderId, object);
        if (financial.status === "paid") {
          await ensureProcurementIntentsForPaidOrder(tx, orderId);
        }
      }
      break;
    case "payment_intent.succeeded":
      if (!orderId) throw new Error("WEBHOOK_ORDER_ID_MISSING");
      // When automatic tax is enabled, PaymentIntent does not carry the tax
      // breakdown needed to update the order safely. Checkout Session remains
      // authoritative and will mark payment paid after tax reconciliation.
      if (!stripeAutomaticTaxEnabled()) {
        await markPaymentSucceeded(tx, orderId, object);
      }
      break;
    case "checkout.session.async_payment_failed":
    case "payment_intent.payment_failed":
      if (!orderId) throw new Error("WEBHOOK_ORDER_ID_MISSING");
      await markPaymentFailed(tx, orderId, object);
      break;
    case "refund.created":
    case "refund.updated":
    case "refund.failed": {
      const refund = await reconcileRefund(tx, object);
      orderId = refund.orderId;
      for (const evidence of refundFinancialEvidence) {
        await persistRefundFinancialEvidence(tx, {
          refundId: refund.refundId,
          providerEventId: event.id,
          evidence,
        });
      }
      break;
    }
    case "charge.succeeded":
    case "charge.updated":
      if (feeEvidence) orderId = await reconcilePaymentFee(tx, feeEvidence, event.id);
      break;
    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed":
      orderId = await reconcileDispute(tx, event);
      break;
    default:
      break;
  }

  return orderId;
}

async function claimStripeEvent(
  tx: Prisma.TransactionClient,
  event: StripeEvent,
  rawBody: string,
) {
  const hash = payloadSha256(rawBody);
  const existing = await tx.paymentEvent.findUnique({
    where: { providerEventId: event.id },
    select: { type: true, payloadSha256: true },
  });
  if (existing) {
    if (existing.type !== event.type || existing.payloadSha256 !== hash) {
      throw new Error("WEBHOOK_EVENT_REPLAY_MISMATCH");
    }
    return { duplicate: true };
  }

  try {
    await tx.paymentEvent.create({
      data: {
        providerEventId: event.id,
        type: event.type,
        payloadSha256: hash,
        status: "processing",
      },
    });
  } catch (error) {
    // Only this unique event-ledger insert is allowed to represent a harmless
    // concurrent Stripe retry. Unique failures from order/payment/refund writes
    // must propagate and be retried rather than acknowledged.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new DuplicateStripeEventError();
    }
    throw error;
  }

  return { duplicate: false };
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "WEBHOOK_PAYLOAD_TOO_LARGE" }, { status: 413 });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "WEBHOOK_PAYLOAD_TOO_LARGE" }, { status: 413 });
  }
  const signature = request.headers.get("stripe-signature") || "";

  let secret: string;
  try {
    secret = stripeWebhookSecret();
  } catch {
    return NextResponse.json({ error: "WEBHOOK_NOT_CONFIGURED" }, { status: 503 });
  }

  if (!verifyStripeSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "INVALID_STRIPE_SIGNATURE" }, { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
    if (!event.id?.startsWith("evt_") || !event.type || !event.data?.object) {
      throw new Error("INVALID_EVENT");
    }
    assertStripeEventMode(event, expectedStripeLivemode());
  } catch (error) {
    const message = error instanceof Error ? error.message : "INVALID_EVENT";
    if (message === "STRIPE_EVENT_MODE_MISMATCH") {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: "INVALID_STRIPE_EVENT" }, { status: 400 });
  }

  const existingEvent = await prisma.paymentEvent.findUnique({
    where: { providerEventId: event.id },
    select: { type: true, payloadSha256: true },
  });
  if (existingEvent) {
    if (existingEvent.type !== event.type || !isExactWebhookReplay(existingEvent.payloadSha256, rawBody)) {
      console.error("stripe.webhook.event_id_payload_mismatch", { eventId: event.id, type: event.type });
      return NextResponse.json({ error: "STRIPE_EVENT_REPLAY_MISMATCH" }, { status: 409 });
    }
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    // Financial evidence is fetched only after signature + livemode validation and
    // before the local event is claimed. Transient Stripe API failures therefore
    // remain retryable and cannot leave half-recorded financial truth.
    const feeEvidence = await prepareStripeFeeEvidence(event);
    const refundFinancialEvidence = await prepareRefundFinancialEvidence(event);
    const result = await prisma.$transaction(async (tx) => {
      const claim = await claimStripeEvent(tx, event, rawBody);
      if (claim.duplicate) return { duplicate: true };

      const orderId = await processStripeEvent(
        tx,
        event,
        feeEvidence,
        refundFinancialEvidence,
      );
      await tx.paymentEvent.update({
        where: { providerEventId: event.id },
        data: {
          status: "processed",
          orderId,
          processedAt: new Date(),
        },
      });
      return { duplicate: false };
    });

    return NextResponse.json(
      result.duplicate ? { received: true, duplicate: true } : { received: true },
    );
  } catch (error) {
    if (error instanceof DuplicateStripeEventError) {
      const winner = await prisma.paymentEvent.findUnique({
        where: { providerEventId: event.id },
        select: { type: true, payloadSha256: true },
      });
      if (winner && winner.type === event.type && isExactWebhookReplay(winner.payloadSha256, rawBody)) {
        return NextResponse.json({ received: true, duplicate: true });
      }
      if (winner) {
        return NextResponse.json({ error: "STRIPE_EVENT_REPLAY_MISMATCH" }, { status: 409 });
      }
      console.error("stripe.webhook.concurrent_event_claim_missing", { eventId: event.id, type: event.type });
      return NextResponse.json({ error: "WEBHOOK_PROCESSING_FAILED" }, { status: 500 });
    }

    const message = error instanceof Error ? error.message : "UNKNOWN";
    console.error("stripe.webhook.failed", { eventId: event.id, type: event.type, error: message });
    return NextResponse.json({ error: "WEBHOOK_PROCESSING_FAILED" }, { status: 500 });
  }
}
