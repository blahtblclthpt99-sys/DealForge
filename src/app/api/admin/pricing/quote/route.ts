import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { quoteSellingPrice } from "@/lib/dynamic-pricing";
import { isProductOwner } from "@/lib/owner-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  landedCostCents: z.number().int().positive(),
  targetGrossMarginBps: z.number().int().min(0).max(9_999),
  minimumProfitCents: z.number().int().min(0).optional(),
  paymentFeeBps: z.number().int().min(0).max(9_999).optional(),
  paymentFixedFeeCents: z.number().int().min(0).optional(),
  priceFloorCents: z.number().int().min(0).optional(),
  priceCeilingCents: z.number().int().positive().optional(),
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
    return NextResponse.json({ error: "Invalid pricing request" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid pricing request" }, { status: 400 });
  }

  const quote = quoteSellingPrice(parsed.data);
  return NextResponse.json({ ok: quote.eligible, quote }, { status: quote.eligible ? 200 : 422 });
}
