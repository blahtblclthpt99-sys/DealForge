import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isProductOwner } from "@/lib/owner-access";
import { parseJson } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

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

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function GET(request: Request) {
  const auth = await currentOwner();
  if ("error" in auth) {
    return noStore(NextResponse.json({ error: auth.error }, { status: auth.status }));
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim().slice(0, 120);
  const active = url.searchParams.get("active");

  const where: Prisma.ProductWhereInput = {
    ...(active === "true" ? { commerceEnabled: true } : active === "false" ? { commerceEnabled: false } : {}),
    ...(query
      ? {
          OR: [
            { id: { contains: query } },
            { asin: { contains: query, mode: "insensitive" } },
            { title: { contains: query, mode: "insensitive" } },
            { brand: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const products = await prisma.product.findMany({
    where,
    orderBy: [{ commerceEnabled: "desc" }, { lastUpdated: "desc" }],
    take: 25,
    select: {
      id: true,
      asin: true,
      slug: true,
      title: true,
      brand: true,
      retailer: true,
      affiliateUrl: true,
      availability: true,
      price: true,
      commerceEnabled: true,
      landedCostCents: true,
      sellingPriceCents: true,
      currency: true,
      specifications: true,
      lastUpdated: true,
    },
  });

  const items = products.map((product) => {
    const specs = parseJson<Record<string, unknown>>(product.specifications, {});
    const recommendation = object(specs.commerceRecommendation);
    const recommendationResult = recommendation ? object(recommendation.result) : null;
    const sourceIdentity = recommendation ? object(recommendation.sourceIdentity) : null;
    const activation = object(specs.commerceActivation);
    const deactivation = object(specs.commerceDeactivation);

    return {
      id: product.id,
      asin: product.asin,
      slug: product.slug,
      title: product.title,
      brand: product.brand,
      retailer: product.retailer,
      sourceUrl: product.affiliateUrl,
      availability: product.availability,
      referencePrice: Number.isFinite(product.price) && product.price > 0 ? product.price : null,
      commerceEnabled: product.commerceEnabled,
      landedCostCents: product.landedCostCents,
      sellingPriceCents: product.sellingPriceCents,
      currency: product.currency,
      lastUpdated: product.lastUpdated.toISOString(),
      recommendation: recommendation
        ? {
            status: text(recommendation.status),
            assessedAt: text(recommendation.assessedAt),
            sourceCheckedAt: text(recommendation.sourceCheckedAt),
            sourceVerified: recommendation.sourceVerified === true,
            sourceAvailable: recommendation.sourceAvailable === true,
            maxSourceAgeMs: typeof recommendation.maxSourceAgeMs === "number" ? recommendation.maxSourceAgeMs : null,
            profitabilityScore: typeof recommendationResult?.profitabilityScore === "number" ? recommendationResult.profitabilityScore : null,
            profitabilityTier: text(recommendationResult?.profitabilityTier),
            reviewedRetailer: text(sourceIdentity?.retailer),
            reviewedSourceUrl: text(sourceIdentity?.sourceUrl),
            reviewedAsin: text(sourceIdentity?.asin),
          }
        : null,
      activation: activation
        ? {
            status: text(activation.status),
            activatedAt: text(activation.activatedAt),
          }
        : null,
      deactivation: deactivation
        ? {
            status: text(deactivation.status),
            deactivatedAt: text(deactivation.deactivatedAt),
            reason: text(deactivation.reason),
          }
        : null,
    };
  });

  return noStore(NextResponse.json({ ok: true, items }));
}
