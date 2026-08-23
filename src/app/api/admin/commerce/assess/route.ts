import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { assessCommerceEligibility } from "@/lib/commerce-eligibility";
import { prisma } from "@/lib/db";
import { isFinancialGateCertified } from "@/lib/financial-gate";
import { isProductOwner } from "@/lib/owner-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const landedCostSchema = z.object({
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
  nowMs: z.number().int().positive().optional(),
});

const pricingSchema = z.object({
  targetGrossMarginBps: z.number().int().min(0).max(9_999),
  minimumProfitCents: z.number().int().min(0).optional(),
  paymentFeeBps: z.number().int().min(0).max(9_999).optional(),
  paymentFixedFeeCents: z.number().int().min(0).optional(),
  priceFloorCents: z.number().int().min(0).optional(),
  priceCeilingCents: z.number().int().positive().optional(),
});

const requestSchema = z.object({
  landedCost: landedCostSchema,
  pricing: pricingSchema,
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

export async function POST(req: Request) {
  const auth = await currentOwner();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid commerce assessment request" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid commerce assessment request" }, { status: 400 });
  }

  const financialGateCertified = isFinancialGateCertified();
  const assessment = assessCommerceEligibility({
    financialGateCertified,
    landedCost: parsed.data.landedCost,
    pricing: parsed.data.pricing,
  });

  return NextResponse.json({
    ok: true,
    advisory: true,
    mutatesCatalog: false,
    financialGateCertified,
    assessment,
  });
}
