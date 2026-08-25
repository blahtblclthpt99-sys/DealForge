import { NextResponse } from "next/server";
import { z } from "zod";
import {
  attributableCostFromSpecifications,
  calculateCustomerFriendlyPrice,
} from "@/lib/cart-pricing";
import { evaluateCommerceGate } from "@/lib/commerce-gate";
import { prisma } from "@/lib/db";
import { resolveOperationalCartPricingPolicy } from "@/lib/loss-reserve-policy";
import { checkPersistedOfferBinding } from "@/lib/persisted-offer-binding";
import { readLimitedJson } from "@/lib/request-json";

export const runtime = "nodejs";

const MAX_CART_QUOTE_BODY_BYTES = 24 * 1024;

const CartQuoteSchema = z.object({
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

type RequestedItem = z.infer<typeof CartQuoteSchema>["items"][number];

function normalizeRequestedItems(items: RequestedItem[]) {
  const quantities = new Map<string, number>();
  for (const item of items) {
    const next = (quantities.get(item.productId) ?? 0) + item.quantity;
    if (next > 25) throw new Error("QUANTITY_LIMIT_EXCEEDED");
    quantities.set(item.productId, next);
  }
  return [...quantities.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

function commerceEnabled() {
  return process.env.COMMERCE_ENABLED === "true";
}

export async function POST(request: Request) {
  try {
    if (!commerceEnabled()) {
      return NextResponse.json({ error: "COMMERCE_DISABLED" }, { status: 503 });
    }

    const body = await readLimitedJson(request, MAX_CART_QUOTE_BODY_BYTES);
    if (!body.ok) {
      return NextResponse.json(
        { error: body.error === "BODY_TOO_LARGE" ? "CART_QUOTE_BODY_TOO_LARGE" : "INVALID_CART_QUOTE_REQUEST" },
        { status: body.error === "BODY_TOO_LARGE" ? 413 : 400 },
      );
    }

    const parsed = CartQuoteSchema.safeParse(body.value);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_CART_QUOTE_REQUEST", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const requestedItems = normalizeRequestedItems(parsed.data.items);
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

    const currencies = new Set(products.map((product) => product.currency.toLowerCase()));
    if (currencies.size !== 1) {
      return NextResponse.json({ error: "MIXED_CURRENCY_CART" }, { status: 409 });
    }
    const currency = [...currencies][0];
    if (!/^[a-z]{3}$/.test(currency)) {
      return NextResponse.json({ error: "PRODUCT_CURRENCY_INVALID" }, { status: 409 });
    }
    const pricingPolicy = (await resolveOperationalCartPricingPolicy(currency)).policy;

    const productById = new Map(products.map((product) => [product.id, product]));
    const quotedItems = [] as Array<{
      productId: string;
      slug: string;
      title: string;
      quantity: number;
      currency: string;
      publishedUnitPriceCents: number;
      unitPriceCents: number;
      lineTotalCents: number;
      savingsCents: number;
      savingsPercent: number;
    }>;

    for (const requested of requestedItems) {
      const product = productById.get(requested.productId)!;
      const gate = evaluateCommerceGate({
        commerceEnabled: product.commerceEnabled,
        availability: product.availability,
        sellingPriceCents: product.sellingPriceCents,
        landedCostCents: product.landedCostCents,
        priceVerifiedAt: product.priceVerifiedAt,
        specifications: product.specifications,
      });
      if (!gate.allowed) {
        return NextResponse.json(
          { error: "PRODUCT_COMMERCE_GATE_FAILED", productId: product.id },
          { status: 409 },
        );
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
        return NextResponse.json(
          { error: "PRODUCT_SUPPLIER_BINDING_FAILED", productId: product.id },
          { status: 409 },
        );
      }

      if (
        !Number.isSafeInteger(product.landedCostCents) ||
        !product.landedCostCents ||
        product.landedCostCents <= 0 ||
        !Number.isSafeInteger(product.sellingPriceCents) ||
        !product.sellingPriceCents ||
        product.sellingPriceCents <= 0
      ) {
        return NextResponse.json({ error: "PRODUCT_NOT_PURCHASABLE", productId: product.id }, { status: 409 });
      }

      const pricing = calculateCustomerFriendlyPrice({
        landedCostCents: product.landedCostCents,
        attributableCostCents: attributableCostFromSpecifications(product.specifications),
        publishedPriceCents: product.sellingPriceCents,
        policy: pricingPolicy,
      });
      if (!pricing.eligible) {
        return NextResponse.json(
          { error: pricing.reason ?? "PRODUCT_PRICE_NO_LONGER_SAFE", productId: product.id },
          { status: 409 },
        );
      }

      const lineTotalCents = pricing.customerPriceCents * requested.quantity;
      const savingsCents = pricing.savingsCents * requested.quantity;
      if (!Number.isSafeInteger(lineTotalCents) || lineTotalCents <= 0) {
        return NextResponse.json({ error: "CART_AMOUNT_INVALID" }, { status: 409 });
      }

      quotedItems.push({
        productId: product.id,
        slug: product.slug,
        title: product.title,
        quantity: requested.quantity,
        currency,
        publishedUnitPriceCents: product.sellingPriceCents,
        unitPriceCents: pricing.customerPriceCents,
        lineTotalCents,
        savingsCents,
        savingsPercent: pricing.savingsPercent,
      });
    }

    const subtotalCents = quotedItems.reduce((sum, item) => sum + item.lineTotalCents, 0);
    const publishedSubtotalCents = quotedItems.reduce(
      (sum, item) => sum + item.publishedUnitPriceCents * item.quantity,
      0,
    );
    const savingsCents = quotedItems.reduce((sum, item) => sum + item.savingsCents, 0);

    return NextResponse.json(
      {
        currency,
        subtotalCents,
        publishedSubtotalCents,
        savingsCents,
        quotedAt: new Date().toISOString(),
        items: quotedItems,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "QUANTITY_LIMIT_EXCEEDED") {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    console.error("cart.quote.failed", { error: message });
    return NextResponse.json({ error: "CART_QUOTE_UNAVAILABLE" }, { status: 503 });
  }
}
