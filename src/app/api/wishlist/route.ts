import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicProductWhere } from "@/lib/product-visibility";
import { mutateUserJsonState } from "@/lib/user-json-state";
import { parseJson } from "@/lib/utils";

const wishlistSchema = z.object({
  productId: z.string().trim().min(1).max(100),
  action: z.enum(["add", "remove"]),
});
const MAX_WISHLIST_ITEMS = 500;

function cleanWishlist(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .filter((id): id is string => typeof id === "string")
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id.length <= 100)
    .slice(0, MAX_WISHLIST_ITEMS);
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

  const parsed = wishlistSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (parsed.data.action === "add") {
    const product = await prisma.product.findFirst({
      where: publicProductWhere({ id: parsed.data.productId }),
      select: { id: true },
    });
    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  const result = await mutateUserJsonState<unknown>(
    session.id,
    "wishlist",
    [],
    (current) => {
      const wishlist = cleanWishlist(current);
      if (parsed.data.action === "add") {
        return Array.from(new Set([parsed.data.productId, ...wishlist])).slice(
          0,
          MAX_WISHLIST_ITEMS,
        );
      }
      return wishlist.filter((id) => id !== parsed.data.productId);
    },
  );

  if (result.status === "not-found") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (result.status === "conflict") {
    return NextResponse.json({ error: "Wishlist changed concurrently; retry" }, { status: 409 });
  }

  return NextResponse.json({ ok: true, wishlist: cleanWishlist(result.value) });
}

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { wishlist: true },
  });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const wishlist = cleanWishlist(parseJson<unknown>(user.wishlist || "[]", []));
  if (!wishlist.length) return NextResponse.json({ wishlist: [] });

  const visibleProducts = await prisma.product.findMany({
    where: publicProductWhere({ id: { in: wishlist } }),
    select: { id: true },
  });
  const visible = new Set(visibleProducts.map((product) => product.id));
  return NextResponse.json({ wishlist: wishlist.filter((id) => visible.has(id)) });
}
