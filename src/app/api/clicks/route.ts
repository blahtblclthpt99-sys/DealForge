import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordClick } from "@/lib/products";
import { publicProductWhere } from "@/lib/product-visibility";

const clickSchema = z.object({ productId: z.string().min(1).max(100) });

export async function POST(req: Request) {
  const session = await readSession();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = clickSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid productId" }, { status: 400 });
  }

  const product = await prisma.product.findFirst({
    where: publicProductWhere({ id: parsed.data.productId }),
    select: { id: true },
  });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  await recordClick(product.id, session?.id);
  return NextResponse.json({ ok: true });
}
