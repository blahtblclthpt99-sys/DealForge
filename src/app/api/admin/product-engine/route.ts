import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { prepareCommercialization } from "@/lib/commercialization";
import {
  ingestCandidate,
  productEngineDashboard,
  publishCandidate,
  retryCandidate,
  runProductEngine,
  setEnginePaused,
} from "@/lib/product-engine";

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

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = actionSchema.safeParse(json);
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
        select: { id: true, title: true, specifications: true },
      });
      if (!product) throw new Error("PRODUCT_NOT_FOUND");

      const prepared = prepareCommercialization(product.specifications, {
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
      });

      const updated = await prisma.product.update({
        where: { id: product.id },
        data: {
          sellingPriceCents: prepared.sellingPriceCents,
          landedCostCents: prepared.landedCostCents,
          priceSource: `supplier:${input.supplierName.trim()}`.slice(0, 255),
          priceVerifiedAt: prepared.priceVerifiedAt,
          metadataSource: `supplier:${input.sourceClass}`,
          metadataVerifiedAt: new Date(input.sourceVerifiedAt),
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

      await prisma.productEngineAudit.create({
        data: {
          candidateId: null,
          actor: owner.email,
          action: prepared.decision.allowed ? "commercial_gate_passed" : "commercial_gate_blocked",
          detail: JSON.stringify({
            productId: product.id,
            supplierName: input.supplierName.trim(),
            sourceClass: input.sourceClass,
            contributionProfitCents: prepared.decision.contributionProfitCents,
            contributionMarginBps: prepared.decision.contributionMarginBps,
            reserveTotalCents: prepared.decision.reserveTotalCents,
            reasons: prepared.decision.reasons,
          }),
        },
      });

      return NextResponse.json({
        ok: true,
        commerceReady: prepared.decision.allowed,
        decision: prepared.decision,
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
    const badRequest =
      message === "CERTIFICATION_PRODUCT_IMMUTABLE" ||
      message === "RESALE_AUTHORIZATION_REQUIRED" ||
      message === "SOURCE_URL_HTTPS_REQUIRED" ||
      message === "SOURCE_URL_CREDENTIALS_NOT_ALLOWED" ||
      message === "SOURCE_URL_PRIVATE_HOST" ||
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
