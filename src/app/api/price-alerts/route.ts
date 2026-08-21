import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicProductWhere } from "@/lib/product-visibility";
import { mutateUserJsonState } from "@/lib/user-json-state";
import { parseJson } from "@/lib/utils";

type PriceAlert = {
  id: string;
  productId: string;
  targetPrice: number;
  createdAt: string;
};

const moneySchema = z
  .number()
  .finite()
  .positive()
  .max(1_000_000)
  .transform((value) => Math.round(value * 100) / 100);
const createAlertSchema = z.object({
  productId: z.string().trim().min(1).max(100),
  targetPrice: moneySchema,
});
const deleteAlertSchema = z.object({ id: z.string().trim().min(1).max(100) });
const storedAlertSchema = z.object({
  id: z.string().trim().min(1).max(100),
  productId: z.string().trim().min(1).max(100),
  targetPrice: z.number().finite().positive().max(1_000_000),
  createdAt: z.string().max(64),
});
const MAX_ALERTS = 50;

function cleanAlerts(value: unknown): PriceAlert[] {
  if (!Array.isArray(value)) return [];
  const cleaned: PriceAlert[] = [];
  const seenProducts = new Set<string>();
  for (const item of value) {
    const parsed = storedAlertSchema.safeParse(item);
    if (!parsed.success || seenProducts.has(parsed.data.productId)) continue;
    seenProducts.add(parsed.data.productId);
    cleaned.push({
      ...parsed.data,
      targetPrice: Math.round(parsed.data.targetPrice * 100) / 100,
    });
    if (cleaned.length >= MAX_ALERTS) break;
  }
  return cleaned;
}

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { priceAlerts: true },
  });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const alerts = cleanAlerts(parseJson<unknown>(user.priceAlerts || "[]", []));
  if (!alerts.length) return NextResponse.json({ alerts: [] });

  const visibleProducts = await prisma.product.findMany({
    where: publicProductWhere({ id: { in: alerts.map((alert) => alert.productId) } }),
    select: { id: true },
  });
  const visible = new Set(visibleProducts.map((product) => product.id));
  return NextResponse.json({ alerts: alerts.filter((alert) => visible.has(alert.productId)) });
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

  const product = await prisma.product.findFirst({
    where: publicProductWhere({ id: parsed.data.productId }),
    select: { id: true },
  });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const entry: PriceAlert = {
    id: `a_${crypto.randomUUID()}`,
    productId: parsed.data.productId,
    targetPrice: parsed.data.targetPrice,
    createdAt: new Date().toISOString(),
  };

  const result = await mutateUserJsonState<unknown>(
    session.id,
    "priceAlerts",
    [],
    (current) => {
      const existing = cleanAlerts(current).filter(
        (alert) => alert.productId !== parsed.data.productId,
      );
      return [entry, ...existing].slice(0, MAX_ALERTS);
    },
  );

  if (result.status === "not-found") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (result.status === "conflict") {
    return NextResponse.json({ error: "Price alerts changed concurrently; retry" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, alerts: cleanAlerts(result.value) });
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

  const result = await mutateUserJsonState<unknown>(
    session.id,
    "priceAlerts",
    [],
    (current) => cleanAlerts(current).filter((alert) => alert.id !== parsed.data.id),
  );

  if (result.status === "not-found") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (result.status === "conflict") {
    return NextResponse.json({ error: "Price alerts changed concurrently; retry" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
