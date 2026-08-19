import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

const accountUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  settings: z
    .object({
      emailAlerts: z.boolean().optional(),
    })
    .strict()
    .optional(),
});

export async function PATCH(req: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = accountUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid account settings" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { id: session.id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const updated = await prisma.user.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name,
      settings: parsed.data.settings ? JSON.stringify(parsed.data.settings) : undefined,
    },
  });

  return NextResponse.json({
    ok: true,
    user: { id: updated.id, name: updated.name, email: updated.email },
  });
}
