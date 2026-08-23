import { NextResponse } from "next/server";
import { evaluateCommerceOpportunity, rankCommerceOpportunities } from "@/lib/commerce-opportunity";
import { prisma } from "@/lib/db";
import { isFinancialGateCertified } from "@/lib/financial-gate";
import { isProductOwner } from "@/lib/owner-access";
import { readSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REVIEWED_CANDIDATES = 250;
const MAX_RESULTS = 100;

async function currentOwner() {
  const session = await readSession();
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, email: true, role: true },
  });
  if (!user || !(await isProductOwner(user))) return null;
  return user;
}

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET() {
  const owner = await currentOwner();
  if (!owner) return noStore(NextResponse.json({ error: "Forbidden" }, { status: 403 }));

  const products = await prisma.product.findMany({
    where: {
      commerceEnabled: false,
      specifications: { contains: '"status":"owner_reviewed_recommendation"' },
    },
    orderBy: { lastUpdated: "desc" },
    take: MAX_REVIEWED_CANDIDATES,
    select: {
      id: true,
      slug: true,
      title: true,
      brand: true,
      retailer: true,
      affiliateUrl: true,
      asin: true,
      availability: true,
      currency: true,
      landedCostCents: true,
      sellingPriceCents: true,
      specifications: true,
      clickCount: true,
      viewCount: true,
      lastUpdated: true,
    },
  });

  const financialGateCertified = isFinancialGateCertified();
  const nowMs = Date.now();
  const ranked = rankCommerceOpportunities(products.map((product) => evaluateCommerceOpportunity({
    id: product.id,
    title: product.title,
    financialGateCertified,
    commerceEnabled: false,
    availability: product.availability,
    currency: product.currency,
    landedCostCents: product.landedCostCents,
    sellingPriceCents: product.sellingPriceCents,
    specifications: product.specifications,
    retailer: product.retailer,
    sourceUrl: product.affiliateUrl,
    asin: product.asin,
    clickCount: product.clickCount,
    viewCount: product.viewCount,
    nowMs,
  })));

  const productById = new Map(products.map((product) => [product.id, product]));
  const items = ranked.slice(0, MAX_RESULTS).map((opportunity) => {
    const product = productById.get(opportunity.id)!;
    return {
      ...opportunity,
      slug: product.slug,
      brand: product.brand,
      retailer: product.retailer,
      asin: product.asin,
      sourceUrl: product.affiliateUrl,
      lastUpdated: product.lastUpdated.toISOString(),
    };
  });

  return noStore(NextResponse.json({
    ok: true,
    advisoryOnly: true,
    automaticActivationEnabled: false,
    financialGateCertified,
    scanned: products.length,
    readyCount: ranked.filter((row) => row.readyForOwnerActivation).length,
    blockedCount: ranked.filter((row) => !row.readyForOwnerActivation).length,
    limitedToMostRecentReviewedCandidates: MAX_REVIEWED_CANDIDATES,
    resultLimit: MAX_RESULTS,
    rankingPolicy: [
      "activation_readiness",
      "saved_profitability_tier",
      "saved_profitability_score",
      "saved_estimated_profit_cents",
      "saved_gross_margin_bps",
      "source_freshness_remaining",
    ],
    demandSignalsAffectRanking: false,
    items,
  }));
}
