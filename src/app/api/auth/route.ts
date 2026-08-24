import { Prisma } from "@prisma/client";
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

const MAX_AUTH_BODY_BYTES = 16 * 1024;

const emailSchema = z.string().trim().email().max(320).transform((value) => value.toLowerCase());
const passwordSchema = z
  .string()
  .min(8)
  .max(128)
  .refine((value) => new TextEncoder().encode(value).length <= 72, {
    message: "Password exceeds supported length",
  });
const nameSchema = z.string().trim().min(2).max(100);

const authRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("register"), email: emailSchema, password: passwordSchema, name: nameSchema }),
  z.object({ action: z.literal("login"), email: emailSchema, password: passwordSchema }),
  z.object({ action: z.literal("logout") }),
]);

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function parseAuthRequest(req: Request) {
  const declaredLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AUTH_BODY_BYTES) {
    return { data: null, response: json({ error: "AUTH_REQUEST_TOO_LARGE" }, 413) } as const;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { data: null, response: json({ error: "INVALID_AUTH_REQUEST" }, 400) } as const;
  }

  const parsed = authRequestSchema.safeParse(body);
  if (!parsed.success) {
    return { data: null, response: json({ error: "INVALID_AUTH_REQUEST" }, 400) } as const;
  }
  return { data: parsed.data, response: null } as const;
}

export async function POST(req: Request) {
  const parsed = await parseAuthRequest(req);
  if (parsed.response) return parsed.response;
  const body = parsed.data;

  if (body.action === "register") {
    const existing = await getUserByEmail(body.email);
    if (existing) {
      return json({ error: "Email already registered" }, 409);
    }

    let user;
    try {
      user = await prisma.user.create({
        data: {
          name: body.name,
          email: body.email,
          passwordHash: await hashPassword(body.password),
          role: "user",
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return json({ error: "Email already registered" }, 409);
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
    return json({ ok: true, user: { id: user.id, name: user.name, email: user.email } });
  }

  if (body.action === "login") {
    const user = await getUserByEmail(body.email);
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      return json({ error: "Invalid email or password" }, 401);
    }
    const token = await createSessionToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
    await setSessionCookie(token);
    return json({
      ok: true,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  }

  await clearSessionCookie();
  return json({ ok: true });
}
