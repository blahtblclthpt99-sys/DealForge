import { NextResponse } from "next/server";
import { z } from "zod";
import {
  clearSessionCookie,
  createSessionToken,
  getUserByEmail,
  hashPassword,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { prisma } from "@/lib/db";

const credsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(2).max(80).optional(),
});

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await req.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isUniqueConstraintError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002",
  );
}

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";

  if (action === "register") {
    const parsed = credsSchema.safeParse(body);
    if (!parsed.success || !parsed.data.name) {
      return NextResponse.json({ error: "Invalid registration data" }, { status: 400 });
    }
    const email = parsed.data.email.toLowerCase();
    const existing = await getUserByEmail(email);
    if (existing) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }

    let user;
    try {
      user = await prisma.user.create({
        data: {
          name: parsed.data.name,
          email,
          passwordHash: await hashPassword(parsed.data.password),
          role: "user",
        },
      });
    } catch (error) {
      // The pre-check improves the common response path, while the database
      // unique constraint remains authoritative under concurrent registration.
      if (isUniqueConstraintError(error)) {
        return NextResponse.json({ error: "Email already registered" }, { status: 409 });
      }
      throw error;
    }

    const token = await createSessionToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
    await setSessionCookie(token);
    return NextResponse.json({ ok: true, user: { id: user.id, name: user.name, email: user.email } });
  }

  if (action === "login") {
    const parsed = credsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
    }
    const user = await getUserByEmail(parsed.data.email);
    if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    const token = await createSessionToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
    await setSessionCookie(token);
    return NextResponse.json({
      ok: true,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  }

  if (action === "logout") {
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
