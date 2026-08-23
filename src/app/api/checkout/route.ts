import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { checkDirectCommerceProductSafety } from "@/lib/commerce-runtime-safety";
import { prisma } from "@/lib/db";
import { isFinancialGateCertified } from "@/lib/financial-gate";
import { createOrderAccessToken } from "@/lib/order-access";
import { createStripeCheckoutSession } from "@/lib/stripe-commerce";

export const runtime = "nodejs";

const CheckoutSchema = z.object({
  checkoutKey: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9:_-]+$/),
  email: z.string().trim().email().max(320),
  items: z.array(z.object({ productId: z.string().trim().min(1).max(128), quantity: z.number().int().min(1).max(25) })).min(1).max(20),
});

type RequestedItem = z.infer<typeof CheckoutSchema>["items"][number];
type CheckoutStage = "request" | "session" | "product_lookup" | "order_create" | "stripe_checkout" | "order_update";

function orderNumber() {
  const time = Date.now().toString(36).toUpperCase();
  const entropy = randomBytes(4).toString("hex").toUpperCase();
  return `DF-${time}-${entropy}`;
}

function normalizeRequestedItems(items: RequestedItem[]) {
  const quantities = new Map<string, number>();
  for (const item of items) {
    const next = (quantities.get(item.productId) || 0) + item.quantity;
    if (next > 25) throw new Error("QUANTITY_LIMIT_EXCEEDED");
    quantities.set(item.productId, next);
  }
  return [...quantities.entries()].map(([productId, quantity]) => ({ productId, quantity })).sort((a, b) => a.productId.localeCompare(b.productId));
}

function sameOrderItems(existing: Array<{ productId: string; quantity: number }>, requested: Array<{ productId: string; quantity: number }>) {
  const left = [...existing].sort((a, b) => a.productId.localeCompare(b.productId));
  return left.length === requested.length && left.every((item, index) => item.productId === requested[index].productId && item.quantity === requested[index].quantity);
}

function appUrl(request: Request) {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  return configured || new URL(request.url).origin;
}

function stripeProviderMetadata(message: string) {
  if (!message.startsWith("STRIPE_API_ERROR:")) return null;
  const remainder = message.slice("STRIPE_API_ERROR:".length);
  const [type = "unknown", code = "unknown", param = "unknown"] = remainder.split(":", 4);
  return { type, code, param };
}

function redactedStripeProviderMessage(message: string) {
  if (!message.startsWith("STRIPE_API_ERROR:")) return null;
  const remainder = message.slice("STRIPE_API_ERROR:".length);
  const parts = remainder.split(":");
  const providerMessage = parts.slice(3).join(":").trim();
  if (!providerMessage) return null;
  return providerMessage
    .replace(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+\b/gi, "[redacted-key]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .slice(0, 800);
}

function classifyStripeCheckoutError(message: string) {
  if (message === "STRIPE_SECRET_KEY_MISSING") return "STRIPE_SECRET_KEY_MISSING";
  if (message === "STRIPE_SECRET_KEY_WRONG_TYPE") return "STRIPE_SECRET_KEY_WRONG_TYPE";
  if (message === "STRIPE_CHECKOUT_SESSION_INVALID") return "STRIPE_CHECKOUT_SESSION_INVALID";
  if (message === "STRIPE_SESSION_MISMATCH") return "STRIPE_SESSION_MISMATCH";
  if (/fetch failed|network|socket|tls|connect|timeout/i.test(message)) return "STRIPE_NETWORK_FAILED";
  if (/json|unexpected token|unexpected end/i.test(message)) return "STRIPE_RESPONSE_PARSE_FAILED";
  if (/cloudflare.*context|request context/i.test(message)) return "STRIPE_RUNTIME_CONTEXT_FAILED";
  if (!message.startsWith("STRIPE_API_ERROR:")) return null;
  const detail = message.slice("STRIPE_API_ERROR:".length);
  if (/publishable api key|use a secret api key|pk_(live|test)_/i.test(detail)) return "STRIPE_SECRET_KEY_WRONG_TYPE";
  if (/invalid api key|no api key/i.test(detail)) return "STRIPE_API_AUTH_FAILED";
  if (/permission|not have access|restricted/i.test(detail)) return "STRIPE_API_PERMISSION_DENIED";
  if (/minimum|min_amount|amount.*small|at least/i.test(detail)) return "STRIPE_AMOUNT_BELOW_MINIMUM";
  if (/unknown parameter|unrecognized parameter|received unknown/i.test(detail)) return "STRIPE_UNKNOWN_PARAMETER";
  if (/missing required|required parameter/i.test(detail)) return "STRIPE_MISSING_PARAMETER";
  if (/invalid url|not a valid url/i.test(detail)) return "STRIPE_INVALID_URL";
  if (/customer_email|invalid email/i.test(detail)) return "STRIPE_INVALID_EMAIL";
  if (/line_items|price_data|product_data|unit_amount/i.test(detail)) return "STRIPE_INVALID_LINE_ITEM";
  if (/payment_intent_data/i.test(detail)) return "STRIPE_INVALID_PAYMENT_INTENT_DATA";
  if (/live charges|activate|account.*not.*active|charges.*disabled/i.test(detail)) return "STRIPE_LIVE_CHARGES_DISABLED";
  return "STRIPE_API_REJECTED";
}

async function persistStripeDiagnostic(input: { error: string; stage: CheckoutStage; provider: ReturnType<typeof stripeProviderMetadata>; providerMessage: string | null }) {
  try {
    await prisma.systemLog.create({
      data: {
        level: "error",
        source: "stripe.checkout",
        message: input.error,
        meta: JSON.stringify({ stage: input.stage, provider: input.provider, providerMessage: input.providerMessage }),
      },
    });
  } catch (diagnosticError) {
    console.error("checkout.create.stripe_diagnostic_failed", { errorName: diagnosticError instanceof Error ? diagnosticError.name : "UNKNOWN" });
  }
}

async function markStripeInitializationFailed(orderId: string) {
  try {
    await prisma.order.updateMany({
      where: {
        id: orderId,
        stripeCheckoutSessionId: null,
        status: { notIn: ["paid", "partially_refunded", "refunded"] },
      },
      data: { status: "payment_failed" },
    });
  } catch (stateError) {
    console.error("checkout.create.payment_state_failed", { orderId, errorName: stateError instanceof Error ? stateError.name : "UNKNOWN" });
  }
}

export async function POST(request: Request) {
  let stage: CheckoutStage = "request";
  let orderIdForStripeFailure: string | null = null;
  try {
    const parsed = CheckoutSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "INVALID_CHECKOUT_REQUEST", details: parsed.error.flatten() }, { status: 400 });

    stage = "session";
    const sessionUser = await readSession();
    const email = (sessionUser?.email || parsed.data.email).trim().toLowerCase();
    const requestedItems = normalizeRequestedItems(parsed.data.items);
    const existing = await prisma.order.findUnique({ where: { checkoutKey: parsed.data.checkoutKey }, include: { items: true } });

    if (existing) {
      if (existing.email !== email || !sameOrderItems(existing.items, requestedItems)) return NextResponse.json({ error: "CHECKOUT_KEY_CONFLICT" }, { status: 409 });
      if (existing.status === "paid") return NextResponse.json({ error: "ORDER_ALREADY_PAID", orderNumber: existing.orderNumber }, { status: 409 });
    }

    stage = "product_lookup";
    const productIds = requestedItems.map((item) => item.productId);
    const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
    if (products.length !== productIds.length) return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 409 });

    const financialGateCertified = isFinancialGateCertified();
    const readinessNowMs = Date.now();
    const productById = new Map(products.map((product) => [product.id, product]));
    const pricedItems = requestedItems.map((item) => {
      const product = productById.get(item.productId)!;
      const safety = checkDirectCommerceProductSafety({
        financialGateCertified,
        commerceEnabled: product.commerceEnabled,
        availability: product.availability,
        currency: product.currency,
        landedCostCents: product.landedCostCents,
        sellingPriceCents: product.sellingPriceCents,
        specifications: product.specifications,
        retailer: product.retailer,
        sourceUrl: product.affiliateUrl,
        asin: product.asin,
        nowMs: readinessNowMs,
      });
      if (!safety.safe) throw new Error(`PRODUCT_NOT_PURCHASABLE:${product.id}:${safety.reason}`);
      const lineTotalCents = product.sellingPriceCents! * item.quantity;
      if (!Number.isSafeInteger(lineTotalCents) || lineTotalCents <= 0) throw new Error("ORDER_AMOUNT_INVALID");
      return { product, quantity: item.quantity, unitPriceCents: product.sellingPriceCents!, lineTotalCents };
    });

    const currencies = new Set(pricedItems.map(({ product }) => product.currency.toLowerCase()));
    if (currencies.size !== 1) return NextResponse.json({ error: "MIXED_CURRENCY_CART" }, { status: 409 });
    const currency = [...currencies][0];
    if (currency !== "usd") return NextResponse.json({ error: "PRODUCT_CURRENCY_INVALID" }, { status: 409 });
    const subtotalCents = pricedItems.reduce((sum, item) => sum + item.lineTotalCents, 0);
    if (!Number.isSafeInteger(subtotalCents) || subtotalCents <= 0) return NextResponse.json({ error: "ORDER_AMOUNT_INVALID" }, { status: 409 });

    stage = "order_create";
    const order = existing || await prisma.order.create({
      data: {
        orderNumber: orderNumber(), checkoutKey: parsed.data.checkoutKey, userId: sessionUser?.id || null, email, currency, status: "pending_payment", subtotalCents, totalCents: subtotalCents,
        items: { create: pricedItems.map(({ product, quantity, unitPriceCents, lineTotalCents }) => ({ productId: product.id, productSlug: product.slug, title: product.title, quantity, unitPriceCents, lineTotalCents, landedCostCents: product.landedCostCents })) },
      },
      include: { items: true },
    });
    orderIdForStripeFailure = order.id;

    if (order.currency !== currency || order.totalCents !== subtotalCents || !sameOrderItems(order.items, requestedItems)) return NextResponse.json({ error: "ORDER_PRICE_CHANGED_RESTART_CHECKOUT" }, { status: 409 });

    stage = "stripe_checkout";
    if (order.status === "payment_failed" && !order.stripeCheckoutSessionId) {
      await prisma.order.update({ where: { id: order.id }, data: { status: "pending_payment" } });
    }
    const base = appUrl(request);
    const orderAccessToken = createOrderAccessToken({
      id: order.id,
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
    });
    const stripeSession = await createStripeCheckoutSession({
      orderId: order.id, orderNumber: order.orderNumber, customerEmail: order.email, currency: order.currency,
      lines: order.items.map((item) => ({ name: item.title, unitAmountCents: item.unitPriceCents, quantity: item.quantity })),
      successUrl: `${base}/checkout/success?order=${encodeURIComponent(order.orderNumber)}&access=${encodeURIComponent(orderAccessToken)}`,
      cancelUrl: `${base}/checkout/cancel?order=${encodeURIComponent(order.orderNumber)}`,
    });
    if (!stripeSession.id || !stripeSession.url) throw new Error("STRIPE_CHECKOUT_SESSION_INVALID");
    if (order.stripeCheckoutSessionId && order.stripeCheckoutSessionId !== stripeSession.id) throw new Error("STRIPE_SESSION_MISMATCH");

    stage = "order_update";
    await prisma.order.update({ where: { id: order.id }, data: { stripeCheckoutSessionId: stripeSession.id } });
    const checkoutUrl = `${base}/api/checkout/resume?order=${encodeURIComponent(order.orderNumber)}&key=${encodeURIComponent(parsed.data.checkoutKey)}`;
    return NextResponse.json({ checkoutUrl, orderNumber: order.orderNumber }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message.startsWith("PRODUCT_NOT_PURCHASABLE") || message === "QUANTITY_LIMIT_EXCEEDED") return NextResponse.json({ error: message.split(":")[0] }, { status: 409 });
    const stripeError = classifyStripeCheckoutError(message);
    if (stripeError) {
      if (stage === "stripe_checkout" && orderIdForStripeFailure) await markStripeInitializationFailed(orderIdForStripeFailure);
      const provider = stripeProviderMetadata(message);
      const providerMessage = redactedStripeProviderMessage(message);
      await persistStripeDiagnostic({ error: stripeError, stage, provider, providerMessage });
      console.error("checkout.create.stripe_failed", { error: stripeError, stage, provider });
      return NextResponse.json({ error: stripeError, stage, ...(provider ? { stripe: provider } : {}) }, { status: 503 });
    }
    if (stage === "stripe_checkout") {
      if (orderIdForStripeFailure) await markStripeInitializationFailed(orderIdForStripeFailure);
      console.error("checkout.create.stripe_unclassified", { stage, errorName: error instanceof Error ? error.name : "UNKNOWN" });
      return NextResponse.json({ error: "STRIPE_UNCLASSIFIED_FAILURE", stage }, { status: 503 });
    }
    console.error("checkout.create.failed", { error: message, stage });
    return NextResponse.json({ error: "CHECKOUT_UNAVAILABLE", stage }, { status: 503 });
  }
}
