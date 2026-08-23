import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import {
  activationAuditSpecifications,
  assessProductForActivation,
  disabledActivationSpecifications,
} from "@/lib/commerce-activation";
import { prisma } from "@/lib/db";
import { isFinancialGateCertified } from "@/lib/financial-gate";
import { isProductOwner } from "@/lib/owner-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const activateSchema = z.object({
  confirm: z.literal("ACTIVATE_COMMERCE"),
  fulfillmentMode: z.literal("manual_supplier_purchase"),
});
const disableSchema = z.object({ confirm: z.literal("DISABLE_COMMERCE") });

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

async function activationProduct(id: string) {
  return prisma.product.findUnique({
    where: { id },
    select: {
      id: true,
      retailer: true,
      affiliateUrl: true,
      price: true,
      availability: true,
      specifications: true,
      lastUpdated: true,
      commerceEnabled: true,
      landedCostCents: true,
      sellingPriceCents: true,
      currency: true,
    },
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await currentOwner();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const parsed = activateSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_ACTIVATION_REQUEST" }, { status: 400 });

  const { id } = await context.params;
  const product = await activationProduct(id);
  if (!product) return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  if (product.commerceEnabled) return NextResponse.json({ error: "PRODUCT_ALREADY_ACTIVE" }, { status: 409 });

  const nowMs = Date.now();
  const assessment = assessProductForActivation({
    product,
    financialGateCertified: isFinancialGateCertified(),
    nowMs,
  });
  if (!assessment.eligible || !assessment.recommendation) {
    return NextResponse.json({
      ok: false,
      activated: false,
      reason: assessment.reason,
      commerceAssessment: assessment.commerceAssessment,
    }, { status: 422 });
  }

  const activatedAt = new Date(nowMs).toISOString();
  const specifications = activationAuditSpecifications({
    specifications: product.specifications,
    activatedAt,
    activatedByUserId: auth.user.id,
    assessment,
    fulfillmentMode: parsed.data.fulfillmentMode,
  });

  try {
    await prisma.$transaction(async (tx) => {
      const write = await tx.product.updateMany({
        where: {
          id: product.id,
          commerceEnabled: false,
          price: product.price,
          availability: product.availability,
          specifications: product.specifications,
          lastUpdated: product.lastUpdated,
          landedCostCents: product.landedCostCents,
          sellingPriceCents: product.sellingPriceCents,
          currency: product.currency,
        },
        data: {
          commerceEnabled: true,
          availability: assessment.source.canonicalAvailability,
          specifications,
        },
      });
      if (write.count !== 1) throw new Error("ACTIVATION_SOURCE_CHANGED");

      await tx.systemLog.create({
        data: {
          level: "info",
          source: "commerce-activation",
          message: `Owner activated DealForge commerce for ${product.id}`,
          meta: JSON.stringify({
            productId: product.id,
            activatedByUserId: auth.user.id,
            fulfillmentMode: parsed.data.fulfillmentMode,
            sourceCheckedAtMs: assessment.source.checkedAtMs,
            priceSource: assessment.source.priceSource,
            landedCostCents: assessment.recommendation.landedCostCents,
            sellingPriceCents: assessment.recommendation.sellingPriceCents,
          }),
        },
      });
      await tx.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });
      await tx.cacheEntry.deleteMany({ where: { key: { startsWith: "categories:" } } });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ACTIVATION_SOURCE_CHANGED") {
      return NextResponse.json({ error: "ACTIVATION_SOURCE_CHANGED" }, { status: 409 });
    }
    console.error("commerce.activation.failed", { productId: product.id, errorName: error instanceof Error ? error.name : "UNKNOWN" });
    return NextResponse.json({ error: "ACTIVATION_FAILED" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    activated: true,
    productId: product.id,
    commerceEnabled: true,
    fulfillmentMode: parsed.data.fulfillmentMode,
    sourceCheckedAtMs: assessment.source.checkedAtMs,
    landedCostCents: assessment.recommendation.landedCostCents,
    sellingPriceCents: assessment.recommendation.sellingPriceCents,
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await currentOwner();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const parsed = disableSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_DISABLE_REQUEST" }, { status: 400 });

  const { id } = await context.params;
  const product = await prisma.product.findUnique({
    where: { id },
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
          specifications: disabledActivationSpecifications(product.specifications, disabledAt, auth.user.id),
        },
      });
      await tx.systemLog.create({
        data: {
          level: "info",
          source: "commerce-activation",
          message: `Owner disabled DealForge commerce for ${product.id}`,
          meta: JSON.stringify({ productId: product.id, disabledByUserId: auth.user.id, disabledAt }),
        },
      });
      await tx.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });
      await tx.cacheEntry.deleteMany({ where: { key: { startsWith: "categories:" } } });
    });
  } catch (error) {
    console.error("commerce.disable.failed", { productId: product.id, errorName: error instanceof Error ? error.name : "UNKNOWN" });
    return NextResponse.json({ error: "DISABLE_FAILED" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, activated: false, commerceEnabled: false, productId: product.id });
}
