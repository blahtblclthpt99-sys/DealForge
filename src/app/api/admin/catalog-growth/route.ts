import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readLimitedJson } from "@/lib/request-json";
import {
  buildBundleProposal,
  canonicalIdentifier,
  parseSupplierCsv,
  supplierRowPrice,
} from "@/lib/catalog-growth";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("preview_supplier_csv"),
    csv: z.string().min(1).max(512 * 1024),
  }).strict(),
  z.object({
    action: z.literal("stage_supplier_csv"),
    csv: z.string().min(1).max(512 * 1024),
  }).strict(),
  z.object({
    action: z.literal("propose_bundle"),
    title: z.string().trim().min(3).max(200),
    productIds: z.array(z.string().trim().min(1).max(128)).min(2).max(8),
  }).strict(),
  z.object({
    action: z.literal("suggest_bundles"),
    categoryId: z.string().trim().min(1).max(128).optional(),
    limit: z.number().int().min(1).max(20).default(10),
  }).strict(),
]);

async function requireOwner() {
  const session = await requireAdmin();
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, email: true, role: true },
  });
  if (!user || user.role !== "admin") throw new Error("FORBIDDEN");
  const ownerEmail = process.env.PRODUCT_ENGINE_OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail || user.email.toLowerCase() !== ownerEmail) throw new Error("FORBIDDEN");
  return user;
}

function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if (!origin) return process.env.NODE_ENV !== "production" && (!site || site === "same-origin" || site === "none");
  try {
    return new URL(origin).origin === new URL(req.url).origin && (!site || site === "same-origin" || site === "none");
  } catch {
    return false;
  }
}

function authError(error: unknown) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (error instanceof Error && error.message === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return null;
}

function previewRows(csv: string) {
  const rows = parseSupplierCsv(csv);
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const canonicalId = canonicalIdentifier(row);
    const duplicateInBatch = seen.has(canonicalId);
    seen.add(canonicalId);
    const pricing = supplierRowPrice(row);
    return {
      row: index + 2,
      canonicalId,
      supplierKey: row.supplierKey,
      externalId: row.externalId,
      title: row.title,
      brand: row.brand,
      category: row.category,
      currency: row.currency,
      availability: row.availability,
      inventoryConfidenceBps: row.inventoryConfidenceBps,
      observedAt: row.observedAt,
      landedCostCents: pricing.landedCostCents,
      recommendedPriceCents: pricing.recommendedPriceCents,
      contributionProfitCents: pricing.contributionProfitCents,
      contributionMarginBps: pricing.contributionMarginBps,
      duplicateInBatch,
      stageable: !duplicateInBatch,
    };
  });
}

async function productComponents(productIds: string[]) {
  const unique = Array.from(new Set(productIds));
  if (unique.length !== productIds.length) throw new Error("BUNDLE_DUPLICATE_COMPONENT");
  const products = await prisma.product.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      title: true,
      categoryId: true,
      currency: true,
      landedCostCents: true,
      sellingPriceCents: true,
      availability: true,
      priceVerifiedAt: true,
    },
  });
  if (products.length !== unique.length) throw new Error("BUNDLE_PRODUCT_NOT_FOUND");
  const byId = new Map(products.map((product) => [product.id, product]));
  return unique.map((id) => {
    const product = byId.get(id)!;
    return {
      productId: product.id,
      title: product.title,
      categoryId: product.categoryId,
      currency: product.currency,
      landedCostCents: product.landedCostCents ?? 0,
      sellingPriceCents: product.sellingPriceCents ?? 0,
      availability: product.availability,
      priceVerifiedAt: product.priceVerifiedAt,
    };
  });
}

export async function POST(req: Request) {
  try {
    const owner = await requireOwner();
    if (!sameOrigin(req)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    const read = await readLimitedJson(req, 600 * 1024);
    if (!read.ok) return NextResponse.json({ error: read.error === "BODY_TOO_LARGE" ? "Request too large" : "Invalid JSON" }, { status: read.error === "BODY_TOO_LARGE" ? 413 : 400 });
    const parsed = actionSchema.safeParse(read.value);
    if (!parsed.success) return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 });
    const input = parsed.data;

    if (input.action === "preview_supplier_csv") {
      const rows = previewRows(input.csv);
      return NextResponse.json({ ok: true, mode: "preview", rows, total: rows.length, stageable: rows.filter((row) => row.stageable).length }, { headers: { "Cache-Control": "private, no-store" } });
    }

    if (input.action === "stage_supplier_csv") {
      const rows = parseSupplierCsv(input.csv);
      const preview = previewRows(input.csv);
      const stageable = preview.filter((row) => row.stageable);
      const staged = await prisma.$transaction(async (tx) => {
        const results = [];
        for (const row of stageable) {
          const source = rows[row.row - 2];
          const existing = await tx.productEngineAudit.findFirst({
            where: { action: "supplier_intake_v2_staged", detail: { contains: `\"canonicalId\":\"${row.canonicalId}\"` } },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          if (existing) {
            results.push({ canonicalId: row.canonicalId, auditId: existing.id, duplicate: true });
            continue;
          }
          const audit = await tx.productEngineAudit.create({
            data: {
              candidateId: null,
              actor: owner.email,
              action: "supplier_intake_v2_staged",
              fromState: "external_feed",
              toState: "quarantined_pending_source_verification",
              detail: JSON.stringify({
                version: 1,
                canonicalId: row.canonicalId,
                source,
                pricing: {
                  landedCostCents: row.landedCostCents,
                  recommendedPriceCents: row.recommendedPriceCents,
                  contributionProfitCents: row.contributionProfitCents,
                  contributionMarginBps: row.contributionMarginBps,
                },
                commerceEnabled: false,
                requires: ["resale_authorization", "supplier_verification", "canonical_match", "commercialization_gate"],
              }),
            },
            select: { id: true },
          });
          results.push({ canonicalId: row.canonicalId, auditId: audit.id, duplicate: false });
        }
        return results;
      });
      return NextResponse.json({ ok: true, mode: "staged", staged, total: staged.length, duplicates: staged.filter((row) => row.duplicate).length }, { status: 201 });
    }

    if (input.action === "propose_bundle") {
      const components = await productComponents(input.productIds);
      const proposal = buildBundleProposal(input.title, components);
      const existing = await prisma.productEngineAudit.findFirst({
        where: { action: "bundle_v1_proposed", detail: { contains: `\"key\":\"${proposal.key}\"` } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      const audit = existing ?? await prisma.productEngineAudit.create({
        data: {
          candidateId: null,
          actor: owner.email,
          action: "bundle_v1_proposed",
          fromState: "candidate",
          toState: proposal.eligible ? "profit_gate_passed" : "quarantined",
          detail: JSON.stringify({ version: 1, ...proposal, commerceEnabled: false }),
        },
        select: { id: true },
      });
      return NextResponse.json({ ok: true, proposal, auditId: audit.id, duplicate: Boolean(existing) }, { status: existing ? 200 : 201 });
    }

    const products = await prisma.product.findMany({
      where: {
        ...(input.categoryId ? { categoryId: input.categoryId } : {}),
        commerceEnabled: true,
        availability: "in_stock",
        landedCostCents: { gt: 0 },
        sellingPriceCents: { gt: 0 },
        priceVerifiedAt: { not: null },
      },
      orderBy: [{ categoryId: "asc" }, { trendingScore: "desc" }],
      take: Math.min(60, input.limit * 4),
      select: {
        id: true,
        title: true,
        categoryId: true,
        currency: true,
        landedCostCents: true,
        sellingPriceCents: true,
        availability: true,
        priceVerifiedAt: true,
      },
    });
    const grouped = new Map<string, typeof products>();
    for (const product of products) {
      const key = `${product.categoryId}:${product.currency.toLowerCase()}`;
      const group = grouped.get(key) ?? [];
      group.push(product);
      grouped.set(key, group);
    }
    const suggestions = [];
    for (const group of grouped.values()) {
      for (let i = 0; i + 1 < group.length && suggestions.length < input.limit; i += 2) {
        const pair = group.slice(i, i + 2);
        const title = `${pair[0].title.slice(0, 70)} + ${pair[1].title.slice(0, 70)} Bundle`;
        const proposal = buildBundleProposal(title, pair.map((product) => ({
          productId: product.id,
          title: product.title,
          categoryId: product.categoryId,
          currency: product.currency,
          landedCostCents: product.landedCostCents ?? 0,
          sellingPriceCents: product.sellingPriceCents ?? 0,
          availability: product.availability,
          priceVerifiedAt: product.priceVerifiedAt,
        })));
        if (proposal.eligible) suggestions.push(proposal);
      }
      if (suggestions.length >= input.limit) break;
    }
    return NextResponse.json({ ok: true, suggestions, total: suggestions.length }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const auth = authError(error);
    if (auth) return auth;
    const message = error instanceof Error ? error.message : "Catalog growth action failed";
    const status = message.includes("NOT_FOUND") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
