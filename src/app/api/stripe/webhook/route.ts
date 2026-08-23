import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  assertStripeEventMode,
  expectedStripeLivemode,
  isExactWebhookReplay,
  payloadSha256,
  stripeWebhookSecret,
  verifyStripeSignature,
  type StripeEvent,
} from "@/lib/stripe-commerce";

export const runtime = "nodejs";

const MAX_WEBHOOK_BYTES = 1024 * 1024;

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
  const raw = object.payment_intent;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return asString((raw as Record<string, unknown>).id);
  }
  return null;
}

function eventObjectPaymentIntentId(object: Record<string, unknown>) {
  const relatedIntent = paymentIntentId(object);
  if (relatedIntent) return relatedIntent;
  const objectId = asString(object.id);
  return objectId?.startsWith("pi_") ? objectId : null;
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

async function markPaymentSucceeded(
  tx: Prisma.TransactionClient,
  orderId: string,
  object: Record<string, unknown>,
) {
  const order = await assertPaymentMatchesOrder(tx, orderId, object);
  const intentId = eventObjectPaymentIntentId(object);
  if (!intentId) throw new Error("WEBHOOK_PAYMENT_INTENT_MISSING");

  const objectId = asString(object.id);
  const sessionId = objectId?.startsWith("cs_") ? objectId : null;
  if (sessionId && order.stripeCheckoutSessionId && order.stripeCheckoutSessionId !== sessionId) {
    throw new Error("WEBHOOK_CHECKOUT_SESSION_MISMATCH");
  }
  if (order.stripePaymentIntentId && order.stripePaymentIntentId !== intentId) {
    throw new Error("WEBHOOK_PAYMENT_INTENT_MISMATCH");
  }

  await tx.payment.upsert({
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

  await tx.order.update({
    where: { id: orderId },
    data: {
      status: "paid",
      stripeCheckoutSessionId: sessionId || order.stripeCheckoutSessionId,
      stripePaymentIntentId: intentId,
      paidAt: order.paidAt || new Date(),
    },
  });
}

async function markPaymentFailed(
  tx: Prisma.TransactionClient,
  orderId: string,
  object: Record<string, unknown>,
) {
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order || order.status === "paid" || order.status === "refunded") return;
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
  await tx.order.update({ where: { id: orderId }, data: { status: "payment_failed" } });
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

  await tx.refund.upsert({
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

  const totals = await tx.refund.aggregate({
    where: { orderId: order.id, status: "succeeded" },
    _sum: { amountCents: true },
  });
  const succeededRefundCents = totals._sum.amountCents || 0;
  if (succeededRefundCents > order.totalCents) throw new Error("REFUND_LEDGER_OVERFLOW");

  await tx.order.update({
    where: { id: order.id },
    data: {
      status:
        succeededRefundCents >= order.totalCents
          ? "refunded"
          : succeededRefundCents > 0
            ? "partially_refunded"
            : order.status,
    },
  });
  return order.id;
}

async function processStripeEvent(tx: Prisma.TransactionClient, event: StripeEvent) {
  const object = event.data.object;
  let orderId = await resolveOrderId(tx, object);

  switch (event.type) {
    case "checkout.session.completed":
      if (asString(object.payment_status) === "paid") {
        if (!orderId) throw new Error("WEBHOOK_ORDER_ID_MISSING");
        await markPaymentSucceeded(tx, orderId, object);
      }
      break;
    case "checkout.session.async_payment_succeeded":
    case "payment_intent.succeeded":
      if (!orderId) throw new Error("WEBHOOK_ORDER_ID_MISSING");
      await markPaymentSucceeded(tx, orderId, object);
      break;
    case "checkout.session.async_payment_failed":
    case "payment_intent.payment_failed":
      if (!orderId) throw new Error("WEBHOOK_ORDER_ID_MISSING");
      await markPaymentFailed(tx, orderId, object);
      break;
    case "refund.created":
    case "refund.updated":
    case "refund.failed":
      orderId = await reconcileRefund(tx, object);
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
    const result = await prisma.$transaction(async (tx) => {
      const claim = await claimStripeEvent(tx, event, rawBody);
      if (claim.duplicate) return { duplicate: true };

      const orderId = await processStripeEvent(tx, event);
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
