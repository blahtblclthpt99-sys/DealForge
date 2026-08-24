import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readLimitedJson } from "@/lib/request-json";
import { parseJson } from "@/lib/utils";

const MAX_WISHLIST_ITEMS = 500;
const WishlistMutationSchema = z
  .object({
    productId: z.string().trim().min(1).max(128),
    action: z.enum(["add", "remove"]),
  })
  .strict();

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function loadWishlist(raw: string) {
  return Array.from(
    new Set(
      parseJson<unknown[]>(raw, [])
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0 && value.length <= 128),
    ),
  ).slice(0, MAX_WISHLIST_ITEMS);
}

export async function POST(req: Request) {
  const session = await readSession();
  if (!session) return json({ error: "UNAUTHORIZED" }, 401);

  const read = await readLimitedJson(req, 2 * 1024);
  if (!read.ok) return json({ error: read.error === "BODY_TOO_LARGE" ? "WISHLIST_REQUEST_TOO_LARGE" : "INVALID_WISHLIST_REQUEST" }, read.error === "BODY_TOO_LARGE" ? 413 : 400);
  const parsed = WishlistMutationSchema.safeParse(read.value);
  if (!parsed.success) return json({ error: "INVALID_WISHLIST_REQUEST" }, 400);

  const user = await prisma.user.findUnique({ where: { id: session.id }, select: { id: true, wishlist: true } });
  if (!user) return json({ error: "UNAUTHORIZED" }, 401);

  let wishlist = loadWishlist(user.wishlist);
  if (parsed.data.action === "add") {
    const product = await prisma.product.findUnique({ where: { id: parsed.data.productId }, select: { id: true } });
    if (!product) return json({ error: "PRODUCT_NOT_FOUND" }, 404);
    if (!wishlist.includes(product.id) && wishlist.length >= MAX_WISHLIST_ITEMS) {
      return json({ error: "WISHLIST_LIMIT_REACHED" }, 409);
    }
    wishlist = Array.from(new Set([product.id, ...wishlist])).slice(0, MAX_WISHLIST_ITEMS);
  } else {
    wishlist = wishlist.filter((id) => id !== parsed.data.productId);
  }

  await prisma.user.update({ where: { id: user.id }, data: { wishlist: JSON.stringify(wishlist) } });
  return json({ ok: true, wishlist });
}

export async function GET() {
  const session = await readSession();
  if (!session) return json({ error: "UNAUTHORIZED" }, 401);
  const user = await prisma.user.findUnique({ where: { id: session.id }, select: { wishlist: true } });
  if (!user) return json({ error: "UNAUTHORIZED" }, 401);
  return json({ wishlist: loadWishlist(user.wishlist) });
}
