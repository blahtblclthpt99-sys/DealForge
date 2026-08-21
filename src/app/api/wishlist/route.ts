import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicProductWhere } from "@/lib/product-visibility";
import { parseJson } from "@/lib/utils";

const wishlistSchema = z.object({
  productId: z.string().min(1).max(100),
  action: z.enum(["add", "remove"]),
});
const MAX_WISHLIST_ITEMS = 500;

export async function POST(req: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = wishlistSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const [user, product] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.id } }),
    prisma.product.findFirst({
      where: publicProductWhere({ id: parsed.data.productId }),
      select: { id: true },
    }),
  ]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  let wishlist = parseJson<string[]>(user.wishlist, []);
  if (parsed.data.action === "add") {
    wishlist = Array.from(new Set([parsed.data.productId, ...wishlist])).slice(0, MAX_WISHLIST_ITEMS);
  } else {
    wishlist = wishlist.filter((id) => id !== parsed.data.productId);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { wishlist: JSON.stringify(wishlist) },
  });

  return NextResponse.json({ ok: true, wishlist });
}

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ wishlist: parseJson<string[]>(user.wishlist || "[]", []) });
}
