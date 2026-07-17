import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseJson } from "@/lib/utils";

export async function POST(req: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { productId, action } = await req.json();
  if (!productId || !["add", "remove"].includes(action)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let wishlist = parseJson<string[]>(user.wishlist, []);
  if (action === "add") {
    wishlist = Array.from(new Set([productId, ...wishlist]));
  } else {
    wishlist = wishlist.filter((id) => id !== productId);
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
  return NextResponse.json({ wishlist: parseJson<string[]>(user?.wishlist || "[]", []) });
}
