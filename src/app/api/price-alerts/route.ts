import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseJson } from "@/lib/utils";

type PriceAlert = {
  id: string;
  productId: string;
  targetPrice: number;
  createdAt: string;
};

const createAlertSchema = z.object({
  productId: z.string().min(1).max(100),
  targetPrice: z.number().finite().positive().max(1_000_000),
});
const deleteAlertSchema = z.object({ id: z.string().min(1).max(100) });
const MAX_ALERTS = 50;

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ alerts: parseJson<PriceAlert[]>(user.priceAlerts || "[]", []) });
}

export async function POST(req: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createAlertSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const [user, product] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.id } }),
    prisma.product.findUnique({ where: { id: parsed.data.productId }, select: { id: true } }),
  ]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const existing = parseJson<PriceAlert[]>(user.priceAlerts, []);
  const withoutSameProduct = existing.filter((alert) => alert.productId !== parsed.data.productId);
  const alerts: PriceAlert[] = [
    {
      id: `a_${Date.now()}`,
      productId: parsed.data.productId,
      targetPrice: parsed.data.targetPrice,
      createdAt: new Date().toISOString(),
    },
    ...withoutSameProduct,
  ].slice(0, MAX_ALERTS);

  await prisma.user.update({
    where: { id: user.id },
    data: { priceAlerts: JSON.stringify(alerts) },
  });
  return NextResponse.json({ ok: true, alerts });
}

export async function DELETE(req: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = deleteAlertSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const alerts = parseJson<PriceAlert[]>(user.priceAlerts, []).filter((a) => a.id !== parsed.data.id);
  await prisma.user.update({
    where: { id: user.id },
    data: { priceAlerts: JSON.stringify(alerts) },
  });
  return NextResponse.json({ ok: true });
}
