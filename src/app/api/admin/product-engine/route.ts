import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import {
  COMMERCE_QUARANTINE_ACTIONS,
  COMMERCE_QUARANTINE_RESOLUTION_ACTION,
  deriveCommerceQuarantineRecords,
  quarantineResolutionAuditId,
} from "@/lib/commerce-quarantine";
import { prisma } from "@/lib/db";
import {
  ingestCandidate,
  productEngineDashboard,
  publishCandidate,
  retryCandidate,
  runProductEngine,
  setEnginePaused,
} from "@/lib/product-engine";
import { readLimitedJson } from "@/lib/request-json";
import { persistSelectAndPrepareCommercialization } from "@/lib/supplier-commercialization";

const candidateSchema = z.object({
  action: z.literal("intake"),
  asin: z.string().trim().min(1).max(20),
  sourceType: z.enum(["owner_asin", "owner_special_link", "public_reference"]),
  sourceUrl: z.string().url().max(2000).nullable().optional(),
  scout: z.enum(["scout-a", "scout-b"]).optional(),
  title: z.string().max(500).nullable().optional(),
  brand: z.string().max(160).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  images: z.array(z.string().url().max(2000)).max(8).optional(),
  category: z.string().max(100).nullable().optional(),
  ownerSpecialLink: z.string().url().max(2000).nullable().optional(),
  variationKey: z.string().max(160).nullable().optional(),
}).strict();

const commercializeSchema = z.object({
  action: z.literal("commercialize"),
  productId: z.string().trim().min(1).max(128),
  supplierName: z.string().trim().min(2).max(160),
  sourceClass: z.enum([
    "manufacturer",
    "wholesale",
    "distributor",
    "authorized_dropshipper",
    "retailer_permitting_resale",
  ]),
  sourceUrl: z.string().url().max(2000).nullable().optional(),
  resaleAllowed: z.literal(true),
  sourceVerifiedAt: z.string().trim().min(1).max(64),
  priceVerifiedAt: z.string().trim().min(1).max(64),
  itemCostCents: z.number().int().positive(),
  shippingCents: z.number().int().nonnegative().default(0),
  taxCents: z.number().int().nonnegative().default(0),
  supplierFeeCents: z.number().int().nonnegative().default(0),
  handlingCents: z.number().int().nonnegative().default(0),
  sellingPriceCents: z.number().int().positive(),
  inventoryConfidenceBps: z.number().int().min(0).max(10_000),
  acquisitionReserveCents: z.number().int().nonnegative().default(0),
  availability: z.enum(["in_stock", "out_of_stock", "unknown"]),
  taxClassification: z.string().trim().min(2).max(160),
  stripeTaxCode: z.string().trim().regex(/^txcd_[A-Za-z0-9]+$/).max(64),
  taxVerifiedAt: z.string().trim().min(1).max(64),
  taxVerificationSource: z.string().trim().min(2).max(160),
  taxMaxAgeDays: z.number().int().min(1).max(3650).default(365),
}).strict();

const actionSchema = z.discriminatedUnion("action", [
  candidateSchema,
  commercializeSchema,
  z.object({ action: z.literal("run") }).strict(),
  z.object({ action: z.literal("pause") }).strict(),
  z.object({ action: z.literal("resume") }).strict(),
  z.object({ action: z.literal("publish"), candidateId: z.string().min(1).max(100) }).strict(),
  z.object({ action: z.literal("retry"), candidateId: z.string().min(1).max(100) }).strict(),
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

function authError(error: unknown) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (error instanceof Error && error.message === "FORBIDDEN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
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

function selectionReasons(selection: Awaited<ReturnType<typeof persistSelectAndPrepareCommercialization>>["selection"]) {
  return selection.evaluated.map((entry) => ({
    offerId: entry.offer.id,
    supplierId: entry.offer.supplierId,
    eligible: entry.eligible,
    reasons: entry.reasons,
    landedCostCents: entry.landedCostCents,
  }));
}

async function latestOpenQuarantine(productId: string) {
  const audits = await prisma.productEngineAudit.findMany({
    where: {
      action: {
        in: [...COMMERCE_QUARANTINE_ACTIONS, COMMERCE_QUARANTINE_RESOLUTION_ACTION],
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { id: true, action: true, detail: true, createdAt: true },
  });
  return deriveCommerceQuarantineRecords(audits).find((record) => record.productId === productId) ?? null;
}

export async function GET() {
  try {
    await requireOwner();
    return NextResponse.json(await productEngineDashboard(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return authError(error) ?? NextResponse.json({ error: "Product Engine unavailable" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const owner = await requireOwner();
    if (!sameOrigin(req)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });

    const read = await readLimitedJson(req, 32 * 1024);
    if (!read.ok) {
      return NextResponse.json(
        { error: read.error === "BODY_TOO_LARGE" ? "Product Engine request too large" : "Invalid JSON" },
        { status: read.error === "BODY_TOO_LARGE" ? 413 : 400 },
      );
    }
    const parsed = actionSchema.safeParse(read.value);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 });
    }

    const input = parsed.data;
    if (input.action === "intake") {
      const result = await ingestCandidate({
        asin: input.asin,
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl,
        scout: input.scout,
        title: input.title,
        brand: input.brand,
        description: input.description,
        images: input.images,
        category: input.category,
        ownerSpecialLink: input.ownerSpecialLink,
        variationKey: input.variationKey,
      }, owner.email);
      return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
    }

    if (input.action === "commercialize") {
      const product = await prisma.product.findUnique({
        where: { id: input.productId },
        select: { id: true, title: true, specifications: true, currency: true, commerceEnabled: true },
      });
      if (!product) throw new Error("PRODUCT_NOT_FOUND");

      const result = await persistSelectAndPrepareCommercialization({
        productId: product.id,
        productCurrency: product.currency,
        existingSpecifications: product.specifications,
        supplierName: input.supplierName,
        sourceClass: input.sourceClass,
        sourceUrl: input.sourceUrl,
        resaleAllowed: input.resaleAllowed,
        sourceVerifiedAt: input.sourceVerifiedAt,
        priceVerifiedAt: input.priceVerifiedAt,
        itemCostCents: input.itemCostCents,
        shippingCents: input.shippingCents,
        taxCents: input.taxCents,
        supplierFeeCents: input.supplierFeeCents,
        handlingCents: input.handlingCents,
        sellingPriceCents: input.sellingPriceCents,
        inventoryConfidenceBps: input.inventoryConfidenceBps,
        acquisitionReserveCents: input.acquisitionReserveCents,
        availability: input.availability,
        taxClassification: input.taxClassification,
        stripeTaxCode: input.stripeTaxCode,
        taxVerifiedAt: input.taxVerifiedAt,
        taxVerificationSource: input.taxVerificationSource,
        taxMaxAgeDays: input.taxMaxAgeDays,
      });

      if (!result.prepared || !result.selection.selected) {
        const evaluated = selectionReasons(result.selection);
        await prisma.productEngineAudit.create({
          data: {
            candidateId: null,
            actor: owner.email,
            action: "commercial_gate_blocked_no_supplier_offer",
            detail: JSON.stringify({
              productId: product.id,
              submittedSupplierId: result.submittedSupplierId,
              submittedOfferId: result.submittedOfferId,
              evaluated,
            }),
          },
        });
        return NextResponse.json(
          {
            ok: false,
            error: "NO_ELIGIBLE_SUPPLIER_OFFER",
            submittedOfferId: result.submittedOfferId,
            evaluated,
          },
          { status: 409 },
        );
      }

      const prepared = result.prepared;
      const selected = result.selection.selected.offer;
      const recovery = !product.commerceEnabled && prepared.commerceEnabled
        ? await latestOpenQuarantine(product.id)
        : null;
      const resolvedAt = new Date();
      const commercialDetail = {
        productId: product.id,
        submittedSupplierId: result.submittedSupplierId,
        submittedOfferId: result.submittedOfferId,
        selectedSupplierId: selected.supplierId,
        selectedOfferId: selected.id,
        selectedOfferKey: selected.offerKey ?? null,
        stripeTaxCode: input.stripeTaxCode,
        taxClassification: input.taxClassification,
        taxVerificationSource: input.taxVerificationSource,
        taxVerifiedAt: input.taxVerifiedAt,
        contributionProfitCents: prepared.decision.contributionProfitCents,
        contributionMarginBps: prepared.decision.contributionMarginBps,
        reserveTotalCents: prepared.decision.reserveTotalCents,
        reasons: prepared.decision.reasons,
        evaluatedOfferCount: result.selection.evaluated.length,
      };

      const updated = await prisma.$transaction(async (tx) => {
        const saved = await tx.product.update({
          where: { id: product.id },
          data: {
            sellingPriceCents: prepared.sellingPriceCents,
            landedCostCents: prepared.landedCostCents,
            priceSource: `supplier-offer:${selected.id}`.slice(0, 255),
            priceVerifiedAt: prepared.priceVerifiedAt,
            metadataSource: `supplier:${selected.supplierId}`.slice(0, 255),
            metadataVerifiedAt: selected.sourceVerifiedAt,
            availability: prepared.availability,
            specifications: prepared.specifications,
            commerceEnabled: prepared.commerceEnabled,
          },
          select: {
            id: true,
            title: true,
            commerceEnabled: true,
            sellingPriceCents: true,
            landedCostCents: true,
            priceSource: true,
            priceVerifiedAt: true,
            metadataSource: true,
            metadataVerifiedAt: true,
            availability: true,
          },
        });

        await tx.productEngineAudit.create({
          data: {
            candidateId: null,
            actor: owner.email,
            action: prepared.decision.allowed ? "commercial_gate_passed" : "commercial_gate_blocked",
            detail: JSON.stringify(commercialDetail),
          },
        });

        if (recovery && saved.commerceEnabled) {
          const blockedDurationMs = Math.max(0, resolvedAt.getTime() - recovery.quarantinedAt.getTime());
          await tx.productEngineAudit.upsert({
            where: { id: quarantineResolutionAuditId(recovery.auditId) },
            create: {
              id: quarantineResolutionAuditId(recovery.auditId),
              candidateId: null,
              actor: owner.email,
              action: COMMERCE_QUARANTINE_RESOLUTION_ACTION,
              detail: JSON.stringify({
                productId: product.id,
                quarantineAuditId: recovery.auditId,
                quarantineAction: recovery.action,
                quarantineReasons: recovery.reasons,
                quarantinedAt: recovery.quarantinedAt.toISOString(),
                resolvedAt: resolvedAt.toISOString(),
                blockedDurationMs,
                resolution: "owner_commercialization_gate_passed",
                refreshedEvidence: {
                  selectedSupplierId: selected.supplierId,
                  selectedOfferId: selected.id,
                  selectedOfferKey: selected.offerKey ?? null,
                  sourceVerifiedAt: selected.sourceVerifiedAt?.toISOString() ?? null,
                  priceVerifiedAt: prepared.priceVerifiedAt.toISOString(),
                  inventoryConfidenceBps: selected.inventoryConfidenceBps,
                  availability: prepared.availability,
                  sellingPriceCents: prepared.sellingPriceCents,
                  landedCostCents: prepared.landedCostCents,
                  stripeTaxCode: input.stripeTaxCode,
                  taxClassification: input.taxClassification,
                  taxVerificationSource: input.taxVerificationSource,
                  taxVerifiedAt: input.taxVerifiedAt,
                  contributionProfitCents: prepared.decision.contributionProfitCents,
                  contributionMarginBps: prepared.decision.contributionMarginBps,
                },
              }),
            },
            update: {},
          });
        }

        return saved;
      });

      return NextResponse.json({
        ok: true,
        commerceReady: prepared.decision.allowed,
        quarantineResolved: Boolean(recovery && updated.commerceEnabled),
        decision: prepared.decision,
        selectedOffer: {
          supplierId: selected.supplierId,
          offerId: selected.id,
          offerKey: selected.offerKey ?? null,
          landedCostCents: result.selection.selected.landedCostCents,
        },
        product: updated,
      });
    }

    if (input.action === "run") return NextResponse.json(await runProductEngine(owner.email));
    if (input.action === "pause") return NextResponse.json(await setEnginePaused(true, owner.email));
    if (input.action === "resume") return NextResponse.json(await setEnginePaused(false, owner.email));
    if (input.action === "publish") return NextResponse.json(await publishCandidate(input.candidateId, owner.email));
    if (input.action === "retry") return NextResponse.json(await retryCandidate(input.candidateId, owner.email));
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const response = authError(error);
    if (response) return response;
    const message = error instanceof Error ? error.message : "Product Engine action failed";
    if (message === "PRODUCT_NOT_FOUND") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (["SUPPLIER_KEY_CONFLICT", "SUPPLIER_OFFER_KEY_CONFLICT", "SUPPLIER_OFFER_VERIFICATION_CONFLICT"].includes(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    const badRequest =
      message === "CERTIFICATION_PRODUCT_IMMUTABLE" ||
      message === "RESALE_AUTHORIZATION_REQUIRED" ||
      message === "SOURCE_URL_HTTPS_REQUIRED" ||
      message === "SOURCE_URL_CREDENTIALS_NOT_ALLOWED" ||
      message === "SOURCE_URL_PRIVATE_HOST" ||
      message === "TAX_CLASSIFICATION_STALE" ||
      message.endsWith("_INVALID") ||
      message.endsWith("_IN_FUTURE") ||
      [
        "INVALID_ASIN",
        "INVALID_SOURCE_TYPE",
        "INVALID_AMAZON_SPECIAL_LINK",
        "SPECIAL_LINK_ASIN_MISMATCH",
        "SOURCE_URL_SCHEME",
        "NOT_RETRYABLE",
      ].includes(message);
    return NextResponse.json(
      { error: badRequest ? message : "Product Engine action failed" },
      { status: badRequest ? 400 : 500 },
    );
  }
}
