import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readLimitedJson } from "@/lib/request-json";
import { parseJson } from "@/lib/utils";

type PriceAlert = {
  id: string;
  productId: string;
  targetPrice: number;
  createdAt: string;
};

const MAX_ALERTS = 50;
const PostSchema = z
  .object({
    productId: z.string().trim().min(1).max(128),
    targetPrice: z.number().finite().positive().max(1_000_000),
  })
  .strict();
const DeleteSchema = z.object({ id: z.string().trim().min(3).max(80) }).strict();

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function loadAlerts(raw: string) {
  return parseJson<PriceAlert[]>(raw, []).filter(
    (alert) =>
      alert &&
      typeof alert.id === "string" && alert.id.length <= 80 &&
      typeof alert.productId === "string" && alert.productId.length <= 128 &&
      typeof alert.targetPrice === "number" && Number.isFinite(alert.targetPrice) && alert.targetPrice > 0 &&
      typeof alert.createdAt === "string" && alert.createdAt.length <= 64,
  ).slice(0, MAX_ALERTS);
}

export async function GET() {
  const session = await readSession();
  if (!session) return json({ error: "UNAUTHORIZED" }, 401);
  const user = await prisma.user.findUnique({ where: { id: session.id }, select: { priceAlerts: true } });
  if (!user) return json({ error: "UNAUTHORIZED" }, 401);
  return json({ alerts: loadAlerts(user.priceAlerts) });
}

export async function POST(req: Request) {
  const session = await readSession();
  if (!session) return json({ error: "UNAUTHORIZED" }, 401);

  const read = await readLimitedJson(req, 4 * 1024);
  if (!read.ok) return json({ error: read.error === "BODY_TOO_LARGE" ? "PRICE_ALERT_REQUEST_TOO_LARGE" : "INVALID_PRICE_ALERT" }, read.error === "BODY_TOO_LARGE" ? 413 : 400);
  const parsed = PostSchema.safeParse(read.value);
  if (!parsed.success) return json({ error: "INVALID_PRICE_ALERT" }, 400);

  const [user, product] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.id }, select: { id: true, priceAlerts: true } }),
    prisma.product.findUnique({ where: { id: parsed.data.productId }, select: { id: true } }),
  ]);
  if (!user) return json({ error: "UNAUTHORIZED" }, 401);
  if (!product) return json({ error: "PRODUCT_NOT_FOUND" }, 404);

  const targetCents = Math.round(parsed.data.targetPrice * 100);
  if (!Number.isSafeInteger(targetCents) || targetCents <= 0) return json({ error: "INVALID_PRICE_ALERT" }, 400);
  const targetPrice = targetCents / 100;

  const alerts = loadAlerts(user.priceAlerts);
  const entry: PriceAlert = {
    id: `a_${Date.now()}`,
    productId: product.id,
    targetPrice,
    createdAt: new Date().toISOString(),
  };
  const next = [entry, ...alerts].slice(0, MAX_ALERTS);
  await prisma.user.update({ where: { id: user.id }, data: { priceAlerts: JSON.stringify(next) } });
  return json({ ok: true, alerts: next });
}

export async function DELETE(req: Request) {
  const session = await readSession();
  if (!session) return json({ error: "UNAUTHORIZED" }, 401);

  const read = await readLimitedJson(req, 2 * 1024);
  if (!read.ok) return json({ error: read.error === "BODY_TOO_LARGE" ? "PRICE_ALERT_REQUEST_TOO_LARGE" : "INVALID_PRICE_ALERT_DELETE" }, read.error === "BODY_TOO_LARGE" ? 413 : 400);
  const parsed = DeleteSchema.safeParse(read.value);
  if (!parsed.success) return json({ error: "INVALID_PRICE_ALERT_DELETE" }, 400);

  const user = await prisma.user.findUnique({ where: { id: session.id }, select: { id: true, priceAlerts: true } });
  if (!user) return json({ error: "UNAUTHORIZED" }, 401);
  const alerts = loadAlerts(user.priceAlerts).filter((alert) => alert.id !== parsed.data.id);
  await prisma.user.update({ where: { id: user.id }, data: { priceAlerts: JSON.stringify(alerts) } });
  return json({ ok: true });
}
