import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createStripeCheckoutSession } from "@/lib/stripe-commerce";

export const runtime = "nodejs";

const CheckoutSchema = z.object({
  checkoutKey: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9:_-]+$/),
  email: z.string().trim().email().max(320),
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1).max(128),
        quantity: z.number().int().min(1).max(25),
      }),
    )
    .min(1)
    .max(20),
});

type RequestedItem = z.infer<typeof CheckoutSchema>["items"][number];

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
  return [...quantities.entries()]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
}

function sameOrderItems(
  existing: Array<{ productId: string; quantity: number }>,
  requested: Array<{ productId: string; quantity: number }>,
) {
  const left = [...existing].sort((a, b) => a.productId.localeCompare(b.productId));
  if (left.length !== requested.length) return false;
  return left.every(
    (item, index) =>
      item.productId === requested[index].productId && item.quantity === requested[index].quantity,
  );
}

function appUrl(request: Request) {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  return new URL(request.url).origin;
}

function commerceEnabled() {
  return process.env.COMMERCE_ENABLED === "true";
}

export async function POST(request: Request) {
  try {
    if (!commerceEnabled()) {
      return NextResponse.json({ error: "COMMERCE_DISABLED" }, { status: 503 });
    }

    const parsed = CheckoutSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_CHECKOUT_REQUEST", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const sessionUser = await readSession();
    const email = (sessionUser?.email || parsed.data.email).trim().toLowerCase();
    const requestedItems = normalizeRequestedItems(parsed.data.items);

    const existing = await prisma.order.findUnique({
      where: { checkoutKey: parsed.data.checkoutKey },
      include: { items: true },
    });

    if (existing) {
      if (existing.email !== email || !sameOrderItems(existing.items, requestedItems)) {
        return NextResponse.json({ error: "CHECKOUT_KEY_CONFLICT" }, { status: 409 });
      }
      if (existing.status === "paid") {
        return NextResponse.json(
          { error: "ORDER_ALREADY_PAID", orderNumber: existing.orderNumber },
          { status: 409 },
        );
      }
    }

    const productIds = requestedItems.map((item) => item.productId);
    const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
    if (products.length !== productIds.length) {
      return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 409 });
    }

    const productById = new Map(products.map((product) => [product.id, product]));
    const pricedItems = requestedItems.map((item) => {
      const product = productById.get(item.productId)!;
      if (
        !product.commerceEnabled ||
        !Number.isSafeInteger(product.sellingPriceCents) ||
        !product.sellingPriceCents ||
        product.sellingPriceCents <= 0 ||
        product.availability !== "in_stock"
      ) {
        throw new Error(`PRODUCT_NOT_PURCHASABLE:${product.id}`);
      }
      const lineTotalCents = product.sellingPriceCents * item.quantity;
      if (!Number.isSafeInteger(lineTotalCents) || lineTotalCents <= 0) {
        throw new Error("ORDER_AMOUNT_INVALID");
      }
      return {
        product,
        quantity: item.quantity,
        unitPriceCents: product.sellingPriceCents,
        lineTotalCents,
      };
    });

    const currencies = new Set(pricedItems.map(({ product }) => product.currency.toLowerCase()));
    if (currencies.size !== 1) {
      return NextResponse.json({ error: "MIXED_CURRENCY_CART" }, { status: 409 });
    }
    const currency = [...currencies][0];
    if (!/^[a-z]{3}$/.test(currency)) {
      return NextResponse.json({ error: "PRODUCT_CURRENCY_INVALID" }, { status: 409 });
    }

    const subtotalCents = pricedItems.reduce((sum, item) => sum + item.lineTotalCents, 0);
    if (!Number.isSafeInteger(subtotalCents) || subtotalCents <= 0) {
      return NextResponse.json({ error: "ORDER_AMOUNT_INVALID" }, { status: 409 });
    }

    const order =
      existing ||
      (await prisma.order.create({
        data: {
          orderNumber: orderNumber(),
          checkoutKey: parsed.data.checkoutKey,
          userId: sessionUser?.id || null,
          email,
          currency,
          status: "pending_payment",
          subtotalCents,
          totalCents: subtotalCents,
          items: {
            create: pricedItems.map(({ product, quantity, unitPriceCents, lineTotalCents }) => ({
              productId: product.id,
              productSlug: product.slug,
              title: product.title,
              quantity,
              unitPriceCents,
              lineTotalCents,
              landedCostCents: product.landedCostCents,
            })),
          },
        },
        include: { items: true },
      }));

    // Repricing is intentionally authoritative. If a pending retry's current cart no longer
    // matches the frozen order snapshot, reject it rather than silently charging stale/new totals.
    if (
      order.currency !== currency ||
      order.totalCents !== subtotalCents ||
      !sameOrderItems(order.items, requestedItems)
    ) {
      return NextResponse.json({ error: "ORDER_PRICE_CHANGED_RESTART_CHECKOUT" }, { status: 409 });
    }

    const base = appUrl(request);
    const stripeSession = await createStripeCheckoutSession({
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerEmail: order.email,
      currency: order.currency,
      lines: order.items.map((item) => ({
        name: item.title,
        unitAmountCents: item.unitPriceCents,
        quantity: item.quantity,
      })),
      successUrl: `${base}/checkout/success?order=${encodeURIComponent(order.orderNumber)}`,
      cancelUrl: `${base}/checkout/cancel?order=${encodeURIComponent(order.orderNumber)}`,
    });

    if (!stripeSession.id || !stripeSession.url) {
      throw new Error("STRIPE_CHECKOUT_SESSION_INVALID");
    }

    if (order.stripeCheckoutSessionId && order.stripeCheckoutSessionId !== stripeSession.id) {
      throw new Error("STRIPE_SESSION_MISMATCH");
    }

    await prisma.order.update({
      where: { id: order.id },
      data: { stripeCheckoutSessionId: stripeSession.id },
    });

    return NextResponse.json(
      {
        checkoutUrl: stripeSession.url,
        orderNumber: order.orderNumber,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message.startsWith("PRODUCT_NOT_PURCHASABLE") || message === "QUANTITY_LIMIT_EXCEEDED") {
      return NextResponse.json({ error: message.split(":")[0] }, { status: 409 });
    }
    console.error("checkout.create.failed", { error: message });
    return NextResponse.json({ error: "CHECKOUT_UNAVAILABLE" }, { status: 503 });
  }
}
