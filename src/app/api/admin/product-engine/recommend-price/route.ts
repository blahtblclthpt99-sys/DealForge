import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recommendCommercialPrice } from "@/lib/commercialization";

const schema = z.object({
  itemCostCents: z.number().int().positive(),
  shippingCents: z.number().int().nonnegative().default(0),
  taxCents: z.number().int().nonnegative().default(0),
  supplierFeeCents: z.number().int().nonnegative().default(0),
  handlingCents: z.number().int().nonnegative().default(0),
  acquisitionReserveCents: z.number().int().nonnegative().default(0),
  marketReferenceCents: z.number().int().positive().nullable().optional(),
  maxMarketPremiumBps: z.number().int().min(0).max(10_000).default(1000),
}).strict();

async function requireOwner() {
  const session = await requireAdmin();
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { email: true, role: true },
  });
  const ownerEmail = process.env.PRODUCT_ENGINE_OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail || !user || user.role !== "admin" || user.email.toLowerCase() !== ownerEmail) {
    throw new Error("FORBIDDEN");
  }
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

export async function POST(req: Request) {
  try {
    await requireOwner();
    if (!sameOrigin(req)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 });
    }

    const recommendation = recommendCommercialPrice(parsed.data);
    return NextResponse.json({
      ok: true,
      recommendation,
      mode: "recommendation_only",
      note: "No product, price, or commerce state was changed.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PRICE_RECOMMENDATION_FAILED";
    if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (message === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const badRequest = message.endsWith("_INVALID") || message === "DYNAMIC_PRICE_DID_NOT_CONVERGE";
    return NextResponse.json({ error: badRequest ? message : "PRICE_RECOMMENDATION_FAILED" }, { status: badRequest ? 400 : 500 });
  }
}
