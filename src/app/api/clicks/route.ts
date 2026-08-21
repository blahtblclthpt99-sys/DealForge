import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordClick } from "@/lib/products";
import { publicProductWhere } from "@/lib/product-visibility";

const clickSchema = z.object({ productId: z.string().trim().min(1).max(100) });

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

  const [product, currentUser] = await Promise.all([
    prisma.product.findFirst({
      where: publicProductWhere({ id: parsed.data.productId }),
      select: { id: true },
    }),
    session
      ? prisma.user.findUnique({ where: { id: session.id }, select: { id: true } })
      : Promise.resolve(null),
  ]);
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  // A JWT from another device can outlive an account deletion. Analytics are
  // optional, so treat that stale session as anonymous instead of violating the
  // ClickEvent foreign key and turning a harmless click into a 500 response.
  await recordClick(product.id, currentUser?.id);
  return NextResponse.json({ ok: true });
}
