import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { assessCommerceEligibility } from "@/lib/commerce-eligibility";
import { prisma } from "@/lib/db";
import { isFinancialGateCertified } from "@/lib/financial-gate";
import { isProductOwner } from "@/lib/owner-access";
import { parseJson } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  confirm: z.literal("SAVE_RECOMMENDATION"),
  currency: z.literal("usd"),
  landedCost: z.object({
    itemCostCents: z.number().int().positive(),
    shippingCents: z.number().int().min(0),
    estimatedTaxCents: z.number().int().min(0),
    handlingCents: z.number().int().min(0),
    procurementBufferCents: z.number().int().min(0),
    otherCostCents: z.number().int().min(0),
    sourceVerified: z.boolean(),
    sourceAvailable: z.boolean(),
    sourceCheckedAtMs: z.number().int().positive(),
    maxSourceAgeMs: z.number().int().positive(),
  }),
  pricing: z.object({
    targetGrossMarginBps: z.number().int().min(0).max(9_999),
    minimumProfitCents: z.number().int().min(0).optional(),
    paymentFeeBps: z.number().int().min(0).max(9_999).optional(),
    paymentFixedFeeCents: z.number().int().min(0).optional(),
    priceFloorCents: z.number().int().min(0).optional(),
    priceCeilingCents: z.number().int().positive().optional(),
  }),
});

async function currentOwner() {
  const session = await readSession();
  if (!session) return { error: "Unauthorized" as const, status: 401 as const };

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, email: true, role: true },
  });
  if (!user || !(await isProductOwner(user))) {
    return { error: "Forbidden" as const, status: 403 as const };
  }
  return { user };
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await currentOwner();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid recommendation request" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid recommendation request" }, { status: 400 });
  }

  const { id } = await context.params;
  const product = await prisma.product.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      title: true,
      commerceEnabled: true,
      currency: true,
      specifications: true,
    },
  });

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  // This endpoint is deliberately unable to change an already-live product.
  // Live commerce changes require a separate activation/update workflow.
  if (product.commerceEnabled) {
    return NextResponse.json({ error: "Active products require the live-commerce update workflow" }, { status: 409 });
  }

  const assessedAt = new Date();
  const financialGateCertified = isFinancialGateCertified();
  const assessment = assessCommerceEligibility({
    financialGateCertified,
    landedCost: {
      ...parsed.data.landedCost,
      nowMs: assessedAt.getTime(),
    },
    pricing: parsed.data.pricing,
  });

  if (!assessment.eligible || assessment.landedCostCents === null || assessment.recommendedSellingPriceCents === null) {
    return NextResponse.json({
      error: "Product is not eligible for a saved commerce recommendation",
      assessment,
    }, { status: 422 });
  }

  const specifications = parseJson<Record<string, unknown>>(product.specifications, {});
  const recommendationAudit = {
    status: "owner_reviewed_recommendation",
    assessedAt: assessedAt.toISOString(),
    savedByUserId: auth.user.id,
    sourceCheckedAt: new Date(parsed.data.landedCost.sourceCheckedAtMs).toISOString(),
    sourceVerified: parsed.data.landedCost.sourceVerified,
    sourceAvailable: parsed.data.landedCost.sourceAvailable,
    maxSourceAgeMs: parsed.data.landedCost.maxSourceAgeMs,
    costComponentsCents: {
      item: parsed.data.landedCost.itemCostCents,
      shipping: parsed.data.landedCost.shippingCents,
      estimatedTax: parsed.data.landedCost.estimatedTaxCents,
      handling: parsed.data.landedCost.handlingCents,
      procurementBuffer: parsed.data.landedCost.procurementBufferCents,
      other: parsed.data.landedCost.otherCostCents,
    },
    pricingPolicy: parsed.data.pricing,
    result: {
      landedCostCents: assessment.landedCostCents,
      recommendedSellingPriceCents: assessment.recommendedSellingPriceCents,
      estimatedPaymentFeeCents: assessment.estimatedPaymentFeeCents,
      estimatedProfitCents: assessment.estimatedProfitCents,
      grossMarginBps: assessment.grossMarginBps,
      profitabilityScore: assessment.profitabilityScore,
      profitabilityTier: assessment.profitabilityTier,
    },
  };

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.product.update({
      where: { id: product.id },
      data: {
        landedCostCents: assessment.landedCostCents,
        sellingPriceCents: assessment.recommendedSellingPriceCents,
        currency: parsed.data.currency,
        specifications: JSON.stringify({
          ...specifications,
          commerceRecommendation: recommendationAudit,
        }),
      },
      select: {
        id: true,
        slug: true,
        title: true,
        commerceEnabled: true,
        landedCostCents: true,
        sellingPriceCents: true,
        currency: true,
      },
    });

    await tx.systemLog.create({
      data: {
        level: "info",
        source: "commerce-recommendation",
        message: `Owner saved commerce recommendation for ${product.id}`,
        meta: JSON.stringify({
          productId: product.id,
          savedByUserId: auth.user.id,
          landedCostCents: assessment.landedCostCents,
          sellingPriceCents: assessment.recommendedSellingPriceCents,
          profitabilityScore: assessment.profitabilityScore,
          profitabilityTier: assessment.profitabilityTier,
        }),
      },
    });

    return saved;
  });

  if (updated.commerceEnabled) {
    throw new Error("RECOMMENDATION_ROUTE_COMMERCE_STATE_VIOLATION");
  }

  return NextResponse.json({
    ok: true,
    saved: true,
    commerceEnabled: false,
    product: updated,
    assessment,
  });
}
