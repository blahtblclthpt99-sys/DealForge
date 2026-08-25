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

const MAX_BODY_BYTES = 24 * 1024;
const MAX_RESULTS = 6;
const HARD_ADDON_PRICE_CAP_CENTS = 2_500;
const ADDON_RATIO_BPS = 3_500;

const Schema = z.object({
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

export async function POST(request: Request) {
  try {
    if (process.env.COMMERCE_ENABLED !== "true") {
      return NextResponse.json({ error: "COMMERCE_DISABLED" }, { status: 503 });
    }

    const body = await readLimitedJson(request, MAX_BODY_BYTES);
    if (!body.ok) {
      return NextResponse.json(
        { error: body.error === "BODY_TOO_LARGE" ? "ADDON_SEARCH_BODY_TOO_LARGE" : "INVALID_ADDON_SEARCH" },
        { status: body.error === "BODY_TOO_LARGE" ? 413 : 400 },
      );
    }

    const parsed = Schema.safeParse(body.value);
    if (!parsed.success) {
      return NextResponse.json({ error: "INVALID_ADDON_SEARCH" }, { status: 400 });
    }

    const cartIds = [...new Set(parsed.data.items.map((item) => item.productId))];
    const cartProducts = await prisma.product.findMany({
      where: { id: { in: cartIds } },
      select: {
        id: true,
        brand: true,
        categoryId: true,
        subcategory: true,
        currency: true,
        sellingPriceCents: true,
        landedCostCents: true,
        availability: true,
        commerceEnabled: true,
        priceVerifiedAt: true,
        specifications: true,
      },
    });

    if (cartProducts.length !== cartIds.length) {
      return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 409 });
    }

    const currencies = new Set(cartProducts.map((product) => product.currency.toLowerCase()));
    if (currencies.size !== 1) {
      return NextResponse.json({ error: "MIXED_CURRENCY_CART" }, { status: 409 });
    }
    const currency = [...currencies][0];
    if (!/^[a-z]{3}$/.test(currency)) {
      return NextResponse.json({ error: "PRODUCT_CURRENCY_INVALID" }, { status: 409 });
    }
    const pricingPolicy = (await resolveOperationalCartPricingPolicy(currency)).policy;

    const currentSafePrices: number[] = [];
    for (const product of cartProducts) {
      if (
        !Number.isSafeInteger(product.sellingPriceCents) || !product.sellingPriceCents || product.sellingPriceCents <= 0 ||
        !Number.isSafeInteger(product.landedCostCents) || !product.landedCostCents || product.landedCostCents <= 0
      ) continue;
      const pricing = calculateCustomerFriendlyPrice({
        landedCostCents: product.landedCostCents,
        attributableCostCents: attributableCostFromSpecifications(product.specifications),
        publishedPriceCents: product.sellingPriceCents,
        policy: pricingPolicy,
      });
      if (pricing.eligible) currentSafePrices.push(pricing.customerPriceCents);
    }

    if (currentSafePrices.length === 0) {
      return NextResponse.json({ items: [], reason: "CART_NOT_ELIGIBLE_FOR_ADDONS" });
    }

    const averageCartUnitCents = Math.round(
      currentSafePrices.reduce((sum, value) => sum + value, 0) / currentSafePrices.length,
    );
    const relativeCapCents = Math.floor((averageCartUnitCents * ADDON_RATIO_BPS) / 10_000);
    const addonPriceCapCents = Math.min(HARD_ADDON_PRICE_CAP_CENTS, Math.max(499, relativeCapCents));

    const categoryIds = [...new Set(cartProducts.map((product) => product.categoryId))];
    const subcategories = new Set(cartProducts.map((product) => product.subcategory).filter(Boolean));
    const brands = new Set(cartProducts.map((product) => product.brand.trim().toLowerCase()).filter(Boolean));

    const candidates = await prisma.product.findMany({
      where: {
        id: { notIn: cartIds },
        categoryId: { in: categoryIds },
        currency,
        commerceEnabled: true,
        availability: "in_stock",
        sellingPriceCents: { not: null },
        landedCostCents: { not: null },
      },
      select: {
        id: true,
        slug: true,
        title: true,
        brand: true,
        categoryId: true,
        subcategory: true,
        currency: true,
        commerceEnabled: true,
        availability: true,
        sellingPriceCents: true,
        landedCostCents: true,
        priceVerifiedAt: true,
        specifications: true,
      },
      orderBy: [{ sellingPriceCents: "asc" }, { trendingScore: "desc" }],
      take: 30,
    });

    const eligible: Array<{
      productId: string;
      slug: string;
      title: string;
      brand: string;
      currency: string;
      unitPriceCents: number;
      publishedUnitPriceCents: number;
      savingsCents: number;
      fitLabel: string;
      affinityScore: number;
    }> = [];

    for (const product of candidates) {
      if (
        !Number.isSafeInteger(product.sellingPriceCents) || !product.sellingPriceCents || product.sellingPriceCents <= 0 ||
        !Number.isSafeInteger(product.landedCostCents) || !product.landedCostCents || product.landedCostCents <= 0
      ) continue;

      const gate = evaluateCommerceGate({
        commerceEnabled: product.commerceEnabled,
        availability: product.availability,
        sellingPriceCents: product.sellingPriceCents,
        landedCostCents: product.landedCostCents,
        priceVerifiedAt: product.priceVerifiedAt,
        specifications: product.specifications,
      });
      if (!gate.allowed) continue;

      const binding = await checkPersistedOfferBinding({
        productId: product.id,
        currency: product.currency,
        availability: product.availability,
        landedCostCents: product.landedCostCents,
        priceVerifiedAt: product.priceVerifiedAt,
        specifications: product.specifications,
      });
      if (!binding.allowed) continue;

      const pricing = calculateCustomerFriendlyPrice({
        landedCostCents: product.landedCostCents,
        attributableCostCents: attributableCostFromSpecifications(product.specifications),
        publishedPriceCents: product.sellingPriceCents,
        policy: pricingPolicy,
      });
      if (!pricing.eligible || pricing.customerPriceCents > addonPriceCapCents) continue;

      const sameSubcategory = Boolean(product.subcategory && subcategories.has(product.subcategory));
      const sameBrand = brands.has(product.brand.trim().toLowerCase());
      const affinityScore = (sameSubcategory ? 4 : 0) + (sameBrand ? 2 : 0) + 1;
      const fitLabel = sameSubcategory ? "Same product family" : sameBrand ? "Same brand" : "Same category";

      eligible.push({
        productId: product.id,
        slug: product.slug,
        title: product.title,
        brand: product.brand,
        currency: product.currency.toLowerCase(),
        unitPriceCents: pricing.customerPriceCents,
        publishedUnitPriceCents: product.sellingPriceCents,
        savingsCents: pricing.savingsCents,
        fitLabel,
        affinityScore,
      });
    }

    eligible.sort((a, b) => b.affinityScore - a.affinityScore || a.unitPriceCents - b.unitPriceCents);

    return NextResponse.json({
      items: eligible.slice(0, MAX_RESULTS),
      maxAddonPriceCents: addonPriceCapCents,
      currency,
      searchedAt: new Date().toISOString(),
      method: "category_affinity_plus_safe_price",
    });
  } catch (error) {
    console.error("cart.addons.failed", { error: error instanceof Error ? error.message : "UNKNOWN" });
    return NextResponse.json({ error: "ADDON_SEARCH_UNAVAILABLE" }, { status: 503 });
  }
}
