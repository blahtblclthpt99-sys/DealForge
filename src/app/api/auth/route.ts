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
const registrationPasswordSchema = z
  .string()
  .min(8)
  .max(128)
  .refine((value) => new TextEncoder().encode(value).length <= 72, {
    message: "Password exceeds supported length",
  });
// Keep login compatible with hashes created before the registration byte cap.
// The streamed request-body limit still bounds memory and CPU exposure.
const loginPasswordSchema = z.string().min(8);
const nameSchema = z.string().trim().min(2).max(100);

const authRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("register"),
    email: emailSchema,
    password: registrationPasswordSchema,
    name: nameSchema,
  }),
  z.object({ action: z.literal("login"), email: emailSchema, password: loginPasswordSchema }),
  z.object({ action: z.literal("logout") }),
]);

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function readJsonWithByteLimit(req: Request) {
  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      return { body: null, response: json({ error: "INVALID_AUTH_REQUEST" }, 400) } as const;
    }
    if (declaredLength > MAX_AUTH_BODY_BYTES) {
      return { body: null, response: json({ error: "AUTH_REQUEST_TOO_LARGE" }, 413) } as const;
    }
  }

  if (!req.body) {
    return { body: null, response: json({ error: "INVALID_AUTH_REQUEST" }, 400) } as const;
  }

  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytesRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_AUTH_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { body: null, response: json({ error: "AUTH_REQUEST_TOO_LARGE" }, 413) } as const;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { body: JSON.parse(text) as unknown, response: null } as const;
  } catch {
    return { body: null, response: json({ error: "INVALID_AUTH_REQUEST" }, 400) } as const;
  }
}

async function parseAuthRequest(req: Request) {
  const read = await readJsonWithByteLimit(req);
  if (read.response) return { data: null, response: read.response } as const;

  const parsed = authRequestSchema.safeParse(read.body);
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
