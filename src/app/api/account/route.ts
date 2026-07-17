import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function PATCH(req: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const updated = await prisma.user.update({
    where: { id: session.id },
    data: {
      name: typeof body.name === "string" ? body.name : undefined,
      settings: body.settings ? JSON.stringify(body.settings) : undefined,
    },
  });
  return NextResponse.json({
    ok: true,
    user: { id: updated.id, name: updated.name, email: updated.email },
  });
}
