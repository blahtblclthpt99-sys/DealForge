import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { checkRecommendationSourceBinding } from "@/lib/commerce-source-binding";
import { prisma } from "@/lib/db";
import {
  checkDirectCommerceActivationReadiness,
  checkDirectCommerceReadiness,
} from "@/lib/direct-commerce-readiness";
import { isFinancialGateCertified } from "@/lib/financial-gate";
import { isProductOwner } from "@/lib/owner-access";
import { parseJson } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  confirm: z.literal("ACTIVATE_DIRECT_COMMERCE"),
  fulfillment: z.object({
    sourceOrderable: z.literal(true),
    customerDeliverySupported: z.literal(true),
    returnsSupportReady: z.literal(true),
    manualProcurementAcknowledged: z.literal(true),
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

function hasPublicProductContent(input: {
  title: string;
  description: string;
  images: string;
  specifications: Record<string, unknown>;
}) {
  const title = input.title.trim();
  if (title.length < 4 || title.startsWith("Coach product ") || title.startsWith("Amazon listing ")) {
    return false;
  }
  if (input.description.trim().length < 10) return false;
  if (input.specifications.storefrontBlocked === true || input.specifications.needsEnrichment === true) {
    return false;
  }
  const images = parseJson<unknown[]>(input.images, []);
  return images.some((image) =>
    typeof image === "string" &&
    image.trim().length > 0 &&
    !image.toLowerCase().includes("placeholder"),
  );
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
    return NextResponse.json({ error: "Invalid activation request" }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid activation request" }, { status: 400 });
  }

  const { id } = await context.params;
  const exists = await prisma.product.findUnique({
    where: { id },
    select: { id: true, commerceEnabled: true },
  });
  if (!exists) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  if (exists.commerceEnabled) {
    return NextResponse.json({ error: "Product is already active for direct commerce" }, { status: 409 });
  }

  const activatedAt = new Date();
  const financialGateCertified = isFinancialGateCertified();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.product.findUnique({
        where: { id },
        select: {
          id: true,
          slug: true,
          title: true,
          description: true,
          images: true,
          retailer: true,
          affiliateUrl: true,
          asin: true,
          availability: true,
          currency: true,
          landedCostCents: true,
          sellingPriceCents: true,
          commerceEnabled: true,
          specifications: true,
        },
      });
      if (!current) throw new Error("ACTIVATION_PRODUCT_NOT_FOUND");
      if (current.commerceEnabled) throw new Error("ACTIVATION_ALREADY_ACTIVE");

      const specifications = parseJson<Record<string, unknown>>(current.specifications, {});
      if (!hasPublicProductContent({
        title: current.title,
        description: current.description,
        images: current.images,
        specifications,
      })) {
        throw new Error("ACTIVATION_STOREFRONT_NOT_READY");
      }

      const sourceBinding = checkRecommendationSourceBinding({
        retailer: current.retailer,
        sourceUrl: current.affiliateUrl,
        asin: current.asin,
        specifications,
      });
      if (!sourceBinding.bound) {
        throw new Error(`ACTIVATION_SOURCE:${sourceBinding.reason}`);
      }

      const readiness = checkDirectCommerceActivationReadiness({
        financialGateCertified,
        commerceEnabled: current.commerceEnabled,
        availability: current.availability,
        currency: current.currency,
        landedCostCents: current.landedCostCents,
        sellingPriceCents: current.sellingPriceCents,
        specifications,
        nowMs: activatedAt.getTime(),
      });
      if (!readiness.ready) {
        throw new Error(`ACTIVATION_READINESS:${readiness.reason}`);
      }

      const activationAudit = {
        status: "active",
        activatedAt: activatedAt.toISOString(),
        activatedByUserId: auth.user.id,
        sourceIdentity: {
          retailer: sourceBinding.retailer,
          sourceUrl: sourceBinding.sourceUrl,
          asin: sourceBinding.asin,
        },
        readiness: {
          sourceCheckedAt: readiness.sourceCheckedAtMs === null
            ? null
            : new Date(readiness.sourceCheckedAtMs).toISOString(),
          sourceAgeMs: readiness.sourceAgeMs,
          maxSourceAgeMs: readiness.maxSourceAgeMs,
        },
        fulfillment: parsed.data.fulfillment,
        automaticSupplierPurchasingEnabled: false,
      };
      const nextSpecifications = JSON.stringify({
        ...specifications,
        commerceActivation: activationAudit,
      });

      const write = await tx.product.updateMany({
        where: {
          id: current.id,
          commerceEnabled: false,
          availability: current.availability,
          currency: current.currency,
          landedCostCents: current.landedCostCents,
          sellingPriceCents: current.sellingPriceCents,
          retailer: current.retailer,
          affiliateUrl: current.affiliateUrl,
          asin: current.asin,
          title: current.title,
          images: current.images,
          specifications: current.specifications,
        },
        data: {
          commerceEnabled: true,
          specifications: nextSpecifications,
        },
      });
      if (write.count !== 1) throw new Error("ACTIVATION_CONCURRENT_CHANGE");

      const activated = await tx.product.findUnique({
        where: { id: current.id },
        select: {
          id: true,
          slug: true,
          title: true,
          retailer: true,
          affiliateUrl: true,
          asin: true,
          availability: true,
          currency: true,
          landedCostCents: true,
          sellingPriceCents: true,
          commerceEnabled: true,
          specifications: true,
        },
      });
      if (!activated) throw new Error("ACTIVATION_POSTCONDITION_FAILED");

      const postReadiness = checkDirectCommerceReadiness({
        financialGateCertified,
        commerceEnabled: activated.commerceEnabled,
        availability: activated.availability,
        currency: activated.currency,
        landedCostCents: activated.landedCostCents,
        sellingPriceCents: activated.sellingPriceCents,
        specifications: activated.specifications,
        nowMs: activatedAt.getTime(),
      });
      const postBinding = checkRecommendationSourceBinding({
        retailer: activated.retailer,
        sourceUrl: activated.affiliateUrl,
        asin: activated.asin,
        specifications: activated.specifications,
      });
      if (!postReadiness.ready || !postBinding.bound) {
        throw new Error("ACTIVATION_POSTCONDITION_FAILED");
      }

      await tx.systemLog.create({
        data: {
          level: "warn",
          source: "commerce-activation",
          message: `Owner activated direct commerce for ${activated.id}`,
          meta: JSON.stringify({
            productId: activated.id,
            activatedByUserId: auth.user.id,
            sellingPriceCents: activated.sellingPriceCents,
            sourceCheckedAtMs: postReadiness.sourceCheckedAtMs,
            automaticSupplierPurchasingEnabled: false,
          }),
        },
      });

      return {
        product: {
          id: activated.id,
          slug: activated.slug,
          title: activated.title,
          commerceEnabled: activated.commerceEnabled,
          sellingPriceCents: activated.sellingPriceCents,
          currency: activated.currency,
        },
        readiness: postReadiness,
      };
    });

    return NextResponse.json({
      ok: true,
      activated: true,
      automaticSupplierPurchasingEnabled: false,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "ACTIVATION_PRODUCT_NOT_FOUND") {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    if (message === "ACTIVATION_ALREADY_ACTIVE" || message === "ACTIVATION_CONCURRENT_CHANGE") {
      return NextResponse.json({ error: "Product changed during activation; review again" }, { status: 409 });
    }
    if (message === "ACTIVATION_STOREFRONT_NOT_READY") {
      return NextResponse.json({ error: "Product storefront content is not ready for direct commerce" }, { status: 422 });
    }
    if (message.startsWith("ACTIVATION_SOURCE:")) {
      return NextResponse.json({ error: "Product source identity must be re-reviewed", reason: message.split(":")[1] }, { status: 422 });
    }
    if (message.startsWith("ACTIVATION_READINESS:")) {
      return NextResponse.json({ error: "Product is not ready for direct commerce", reason: message.split(":")[1] }, { status: 422 });
    }
    if (message === "ACTIVATION_POSTCONDITION_FAILED") {
      console.error("commerce.activation.postcondition_failed", { productId: id });
      return NextResponse.json({ error: "Activation safety verification failed" }, { status: 500 });
    }
    throw error;
  }
}
