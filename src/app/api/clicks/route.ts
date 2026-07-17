import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { recordClick } from "@/lib/products";

export async function POST(req: Request) {
  const session = await readSession();
  const { productId } = await req.json();
  if (!productId) return NextResponse.json({ error: "Missing productId" }, { status: 400 });
  await recordClick(productId, session?.id);
  return NextResponse.json({ ok: true });
}
