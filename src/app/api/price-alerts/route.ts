import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseJson } from "@/lib/utils";

type PriceAlert = {
  id: string;
  productId: string;
  targetPrice: number;
  createdAt: string;
};

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: session.id } });
  return NextResponse.json({ alerts: parseJson<PriceAlert[]>(user?.priceAlerts || "[]", []) });
}

export async function POST(req: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { productId, targetPrice } = await req.json();
  if (!productId || typeof targetPrice !== "number") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const alerts = parseJson<PriceAlert[]>(user.priceAlerts, []);
  alerts.unshift({
    id: `a_${Date.now()}`,
    productId,
    targetPrice,
    createdAt: new Date().toISOString(),
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { priceAlerts: JSON.stringify(alerts.slice(0, 50)) },
  });
  return NextResponse.json({ ok: true, alerts: alerts.slice(0, 50) });
}

export async function DELETE(req: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await req.json();
  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const alerts = parseJson<PriceAlert[]>(user.priceAlerts, []).filter((a) => a.id !== id);
  await prisma.user.update({
    where: { id: user.id },
    data: { priceAlerts: JSON.stringify(alerts) },
  });
  return NextResponse.json({ ok: true });
}
