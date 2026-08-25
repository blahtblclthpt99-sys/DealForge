import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { evaluateCommerceGate } from "@/lib/commerce-gate";
import {
  buildOrderSupplierSnapshot,
  serializeOrderSupplierSnapshot,
} from "@/lib/order-source-snapshot";
import { checkPersistedOfferBinding } from "@/lib/persisted-offer-binding";
import { readLimitedJson } from "@/lib/request-json";
import { createStripeCheckoutSession } from "@/lib/stripe-commerce";
import { resolvePublicAppOrigin } from "@/lib/url-security";

export const runtime = "nodejs";

const CERTIFICATION_PRODUCT_ID = "cert_test_75c_20260822_v2";
const TERMINAL_CHECKOUT_STATUSES = new Set(["paid", "refunded", "partially_refunded", "canceled"]);
const MAX_CHECKOUT_BODY_BYTES = 32 * 1024;

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

type OrderEconomicItem = {
  productId: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  landedCostCents: number | null;
  supplierSnapshot: string;
};

type CurrentEconomicItem = {
  product: {
    id: string;
    specifications: string;
    landedCostCents: number | null;
    currency: string;
    availability: string;
    priceVerifiedAt: Date | null;
  };
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  supplierSnapshot: string;
};

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

function sameOrderEconomics(existing: OrderEconomicItem[], current: CurrentEconomicItem[]) {
  if (existing.length !== current.length) return false;
  const currentByProduct = new Map(current.map((item) => [item.product.id, item]));
  return existing.every((item) => {
    const live = currentByProduct.get(item.productId);
    return Boolean(
      live &&
        item.quantity === live.quantity &&
        item.unitPriceCents === live.unitPriceCents &&
        item.lineTotalCents === live.lineTotalCents &&
        item.landedCostCents === live.product.landedCostCents &&
        item.supplierSnapshot === live.supplierSnapshot,
    );
  });
}

function commerceEnabled() {
  return process.env.COMMERCE_ENABLED === "true";
}

function stripeTestMode() {
  return (process.env.STRIPE_SECRET_KEY || "").trim().startsWith("sk_test_");
}

function isInternalCertificationProduct(specifications: string) {
  try {
    const parsed = JSON.parse(specifications) as { internalCertification?: unknown };
    return parsed.internalCertification === true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  let stage = "parse";
  let certificationAttempt = false;

  try {
    const body = await readLimitedJson(request, MAX_CHECKOUT_BODY_BYTES);
    if (!body.ok) {
      return NextResponse.json(
        { error: body.error === "BODY_TOO_LARGE" ? "CHECKOUT_BODY_TOO_LARGE" : "INVALID_CHECKOUT_REQUEST" },
        { status: body.error === "BODY_TOO_LARGE" ? 413 : 400 },
      );
    }

    const parsed = CheckoutSchema.safeParse(body.value);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_CHECKOUT_REQUEST", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    certificationAttempt =
      parsed.data.items.length > 0 &&
      parsed.data.items.every((item) => item.productId === CERTIFICATION_PRODUCT_ID);

    stage = "session";
    const sessionUser = await readSession();
    const email = (sessionUser?.email || parsed.data.email).trim().toLowerCase();
    const requestedItems = normalizeRequestedItems(parsed.data.items);

    stage = "existing_order_lookup";
    const existing = await prisma.order.findUnique({
      where: { checkoutKey: parsed.data.checkoutKey },
      include: { items: true },
    });

    if (existing) {
      if (
        existing.email !== email ||
        !sameOrderItems(existing.items, requestedItems) ||
        (existing.userId !== null && existing.userId !== sessionUser?.id)
      ) {
        return NextResponse.json({ error: "CHECKOUT_KEY_CONFLICT" }, { status: 409 });
      }
      if (TERMINAL_CHECKOUT_STATUSES.has(existing.status)) {
        return NextResponse.json(
          { error: "ORDER_NOT_RETRYABLE", orderNumber: existing.orderNumber },
          { status: 409 },
        );
      }
    }

    stage = "product_lookup";
    const productIds = requestedItems.map((item) => item.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        slug: true,
        title: true,
        specifications: true,
        commerceEnabled: true,
        sellingPriceCents: true,
        landedCostCents: true,
        priceVerifiedAt: true,
        currency: true,
        availability: true,
      },
    });
    if (products.length !== productIds.length) {
      return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 409 });
    }

    stage = "commerce_gate";
    const certificationOnly =
      certificationAttempt &&
      products.length > 0 &&
      products.every((product) => isInternalCertificationProduct(product.specifications));
    const certificationBypass = certificationOnly && stripeTestMode();
    if (!commerceEnabled() && !certificationBypass) {
      return NextResponse.json({ error: "COMMERCE_DISABLED" }, { status: 503 });
    }

    stage = "commercial_gate";
    for (const product of products) {
      if (certificationOnly && isInternalCertificationProduct(product.specifications) && stripeTestMode()) continue;
      const decision = evaluateCommerceGate({
        commerceEnabled: product.commerceEnabled,
        availability: product.availability,
        sellingPriceCents: product.sellingPriceCents,
        landedCostCents: product.landedCostCents,
        priceVerifiedAt: product.priceVerifiedAt,
        specifications: product.specifications,
      });
      if (!decision.allowed) {
        console.warn("checkout.commercial_gate.blocked", {
          productId: product.id,
          reasons: decision.reasons,
          contributionProfitCents: decision.contributionProfitCents,
          contributionMarginBps: decision.contributionMarginBps,
        });
        return NextResponse.json({ error: "PRODUCT_COMMERCE_GATE_FAILED" }, { status: 409 });
      }
    }

    stage = "persisted_offer_binding";
    const supplierSnapshotByProductId = new Map<string, string>();
    for (const product of products) {
      if (certificationOnly && isInternalCertificationProduct(product.specifications) && stripeTestMode()) {
        supplierSnapshotByProductId.set(product.id, "{}");
        continue;
      }
      const binding = await checkPersistedOfferBinding({
        productId: product.id,
        currency: product.currency,
        availability: product.availability,
        landedCostCents: product.landedCostCents,
        priceVerifiedAt: product.priceVerifiedAt,
        specifications: product.specifications,
      });
      if (!binding.allowed) {
        console.warn("checkout.persisted_offer_binding.blocked", {
          productId: product.id,
          persistedOfferId: binding.persistedOfferId,
          reasons: binding.reasons,
        });
        return NextResponse.json({ error: "PRODUCT_SUPPLIER_BINDING_FAILED" }, { status: 409 });
      }

      const snapshot = buildOrderSupplierSnapshot(product.specifications, product.currency);
      if (!snapshot || snapshot.costBreakdown.landedCostCents !== product.landedCostCents) {
        console.warn("checkout.order_supplier_snapshot.invalid", { productId: product.id });
        return NextResponse.json({ error: "PRODUCT_SUPPLIER_BINDING_FAILED" }, { status: 409 });
      }
      supplierSnapshotByProductId.set(product.id, serializeOrderSupplierSnapshot(snapshot));
    }

    stage = "pricing";
    const productById = new Map(products.map((product) => [product.id, product]));
    const pricedItems = requestedItems.map((item) => {
      const product = productById.get(item.productId)!;
      if (isInternalCertificationProduct(product.specifications) && !stripeTestMode()) {
        throw new Error("CERTIFICATION_REQUIRES_TEST_MODE");
      }
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
      const supplierSnapshot = supplierSnapshotByProductId.get(product.id);
      if (supplierSnapshot === undefined) {
        throw new Error("SUPPLIER_SNAPSHOT_MISSING");
      }
      return {
        product,
        quantity: item.quantity,
        unitPriceCents: product.sellingPriceCents,
        lineTotalCents,
        supplierSnapshot,
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

    stage = "order_create";
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
            create: pricedItems.map(
              ({ product, quantity, unitPriceCents, lineTotalCents, supplierSnapshot }) => ({
                productId: product.id,
                productSlug: product.slug,
                title: product.title,
                quantity,
                unitPriceCents,
                lineTotalCents,
                landedCostCents: product.landedCostCents,
                supplierSnapshot,
              }),
            ),
          },
        },
        include: { items: true },
      }));

    stage = "order_integrity";
    if (
      order.currency !== currency ||
      order.subtotalCents !== subtotalCents ||
      order.totalCents !== subtotalCents ||
      !sameOrderItems(order.items, requestedItems) ||
      !sameOrderEconomics(order.items, pricedItems)
    ) {
      return NextResponse.json({ error: "ORDER_PRICE_CHANGED_RESTART_CHECKOUT" }, { status: 409 });
    }

    stage = "pre_stripe_supplier_revalidation";
    for (const item of pricedItems) {
      const product = item.product;
      if (certificationOnly && isInternalCertificationProduct(product.specifications) && stripeTestMode()) continue;
      const binding = await checkPersistedOfferBinding({
        productId: product.id,
        currency: product.currency,
        availability: product.availability,
        landedCostCents: product.landedCostCents,
        priceVerifiedAt: product.priceVerifiedAt,
        specifications: product.specifications,
      });
      const refreshedSnapshot = buildOrderSupplierSnapshot(product.specifications, product.currency);
      if (
        !binding.allowed ||
        !refreshedSnapshot ||
        serializeOrderSupplierSnapshot(refreshedSnapshot) !== item.supplierSnapshot
      ) {
        console.warn("checkout.pre_stripe_supplier_revalidation.blocked", {
          productId: product.id,
          persistedOfferId: binding.persistedOfferId,
          reasons: binding.reasons,
        });
        return NextResponse.json({ error: "ORDER_SOURCE_CHANGED_RESTART_CHECKOUT" }, { status: 409 });
      }
    }

    stage = "stripe_session";
    const base = resolvePublicAppOrigin(request.url);
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
      cardOnly: certificationOnly && stripeTestMode(),
    });

    if (!stripeSession.id || !stripeSession.url) {
      throw new Error("STRIPE_CHECKOUT_SESSION_INVALID");
    }

    stage = "session_binding";
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
    if (
      message.startsWith("PRODUCT_NOT_PURCHASABLE") ||
      message === "QUANTITY_LIMIT_EXCEEDED" ||
      message === "CERTIFICATION_REQUIRES_TEST_MODE"
    ) {
      return NextResponse.json({ error: message.split(":")[0] }, { status: 409 });
    }
    console.error("checkout.create.failed", { error: message, stage });
    return NextResponse.json(
      certificationAttempt ? { error: "CHECKOUT_UNAVAILABLE", stage } : { error: "CHECKOUT_UNAVAILABLE" },
      { status: 503 },
    );
  }
}
