import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import {
  assessCatalogProductForPublication,
  disabledPublicationSpecifications,
  publicationAuditSpecifications,
} from "@/lib/catalog-commerce-publication";
import { prisma } from "@/lib/db";
import { isFinancialGateCertified } from "@/lib/financial-gate";
import { isProductOwner } from "@/lib/owner-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const productIdSchema = z.string().trim().min(1).max(128);
const costsSchema = z.object({
  shippingCents: z.number().int().min(0),
  estimatedTaxCents: z.number().int().min(0),
  handlingCents: z.number().int().min(0),
  procurementBufferCents: z.number().int().min(0),
  otherCostCents: z.number().int().min(0),
});
const pricingSchema = z.object({
  targetGrossMarginBps: z.number().int().min(0).max(9_999),
  minimumProfitCents: z.number().int().min(0).optional(),
  paymentFeeBps: z.number().int().min(0).max(9_999).optional(),
  paymentFixedFeeCents: z.number().int().min(0).optional(),
  priceFloorCents: z.number().int().min(0).optional(),
  priceCeilingCents: z.number().int().positive().optional(),
});
const publishSchema = z.object({ productId: productIdSchema, costs: costsSchema, pricing: pricingSchema });
const disableSchema = z.object({ productId: productIdSchema });

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

async function readJson(request: Request) {
  try {
    return await request.json() as unknown;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const auth = await currentOwner();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const parsed = publishSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_PUBLICATION_REQUEST" }, { status: 400 });

  const product = await prisma.product.findUnique({
    where: { id: parsed.data.productId },
    select: {
      id: true,
      price: true,
      availability: true,
      specifications: true,
      lastUpdated: true,
      currency: true,
    },
  });
  if (!product) return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  if (product.currency.toLowerCase() !== "usd") {
    return NextResponse.json({ error: "PUBLICATION_CURRENCY_UNSUPPORTED" }, { status: 422 });
  }

  const nowMs = Date.now();
  const result = assessCatalogProductForPublication({
    financialGateCertified: isFinancialGateCertified(),
    product,
    costs: parsed.data.costs,
    pricing: parsed.data.pricing,
    nowMs,
  });
  const { assessment, source } = result;
  if (
    !assessment.eligible ||
    assessment.recommendedSellingPriceCents === null ||
    assessment.landedCostCents === null
  ) {
    return NextResponse.json({ ok: false, published: false, result }, { status: 422 });
  }

  const publishedAt = new Date(nowMs).toISOString();
  const specifications = publicationAuditSpecifications({
    existingSpecifications: product.specifications,
    publishedAt,
    source,
    assessment,
    costs: parsed.data.costs,
    pricing: parsed.data.pricing,
  });

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.product.updateMany({
        where: {
          id: product.id,
          price: product.price,
          availability: product.availability,
          specifications: product.specifications,
          lastUpdated: product.lastUpdated,
        },
        data: {
          commerceEnabled: true,
          sellingPriceCents: assessment.recommendedSellingPriceCents!,
          landedCostCents: assessment.landedCostCents!,
          availability: source.canonicalAvailability,
          specifications,
        },
      });
      if (updated.count !== 1) throw new Error("PRODUCT_CHANGED_REASSESS");

      await tx.systemLog.create({
        data: {
          level: "info",
          source: "commerce.publication",
          message: `Published product ${product.id} for DealForge commerce`,
          meta: JSON.stringify({
            productId: product.id,
            sellingPriceCents: assessment.recommendedSellingPriceCents,
            landedCostCents: assessment.landedCostCents,
            estimatedProfitCents: assessment.estimatedProfitCents,
            grossMarginBps: assessment.grossMarginBps,
            profitabilityScore: assessment.profitabilityScore,
            priceSource: source.priceSource,
            sourceCheckedAtMs: source.sourceCheckedAtMs,
          }),
        },
      });
      await tx.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });
      await tx.cacheEntry.deleteMany({ where: { key: { startsWith: "categories:" } } });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PRODUCT_CHANGED_REASSESS") {
      return NextResponse.json({ error: "PRODUCT_CHANGED_REASSESS" }, { status: 409 });
    }
    console.error("commerce.publish.failed", { productId: product.id, errorName: error instanceof Error ? error.name : "UNKNOWN" });
    return NextResponse.json({ error: "PUBLICATION_FAILED" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    published: true,
    productId: product.id,
    sellingPriceCents: assessment.recommendedSellingPriceCents,
    landedCostCents: assessment.landedCostCents,
    estimatedProfitCents: assessment.estimatedProfitCents,
    grossMarginBps: assessment.grossMarginBps,
    profitabilityScore: assessment.profitabilityScore,
    profitabilityTier: assessment.profitabilityTier,
    sourceCheckedAtMs: source.sourceCheckedAtMs,
  });
}

export async function DELETE(request: Request) {
  const auth = await currentOwner();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const parsed = disableSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_DISABLE_REQUEST" }, { status: 400 });

  const product = await prisma.product.findUnique({
    where: { id: parsed.data.productId },
    select: { id: true, specifications: true },
  });
  if (!product) return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });

  const disabledAt = new Date().toISOString();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: product.id },
        data: {
          commerceEnabled: false,
          specifications: disabledPublicationSpecifications(product.specifications, disabledAt),
        },
      });
      await tx.systemLog.create({
        data: {
          level: "info",
          source: "commerce.publication",
          message: `Disabled commerce for product ${product.id}`,
          meta: JSON.stringify({ productId: product.id, disabledAt }),
        },
      });
      await tx.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });
      await tx.cacheEntry.deleteMany({ where: { key: { startsWith: "categories:" } } });
    });
  } catch (error) {
    console.error("commerce.disable.failed", { productId: product.id, errorName: error instanceof Error ? error.name : "UNKNOWN" });
    return NextResponse.json({ error: "DISABLE_FAILED" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, published: false, productId: product.id });
}
