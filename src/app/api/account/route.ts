import { NextResponse } from "next/server";
import { z } from "zod";
import { clearSessionCookie, readSession, verifyPassword } from "@/lib/auth";
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

const accountDeleteSchema = z.object({
  password: z.string().min(8).max(128),
  confirmation: z.literal("DELETE"),
});

async function readJson(req: Request): Promise<unknown | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function PATCH(req: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = await readJson(req);
  if (raw == null) {
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

export async function DELETE(req: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = await readJson(req);
  if (raw == null) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = accountDeleteSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid account deletion request" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, passwordHash: true },
  });
  if (!user) {
    await clearSessionCookie();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return NextResponse.json({ error: "Password verification failed" }, { status: 403 });
  }

  // ClickEvent.user uses onDelete:SetNull, so deleting the user removes account
  // data while preserving anonymous aggregate click history and product metrics.
  await prisma.user.delete({ where: { id: user.id } });
  await clearSessionCookie();

  return NextResponse.json({ ok: true });
}
