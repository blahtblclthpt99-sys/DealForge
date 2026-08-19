import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "./db";

const COOKIE_NAME = "dealforge_session";
const SESSION_DAYS = 14;
const MIN_PRODUCTION_SECRET_LENGTH = 32;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
};

function secretKey() {
  const configured = process.env.AUTH_SECRET?.trim();

  if (process.env.NODE_ENV === "production") {
    if (!configured || configured.length < MIN_PRODUCTION_SECRET_LENGTH) {
      throw new Error(
        `AUTH_SECRET must be configured with at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production`,
      );
    }
  }

  const secret = configured || "dev-insecure-secret";
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(user: SessionUser) {
  return new SignJWT({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
}

export async function readSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.id || !payload.email || !payload.name || !payload.role) return null;
    return {
      id: String(payload.id),
      email: String(payload.email),
      name: String(payload.name),
      role: String(payload.role),
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function requireUser(): Promise<SessionUser> {
  const session = await readSession();
  if (!session) throw new Error("UNAUTHORIZED");

  // Rehydrate from the database so deleted users and role/profile changes take
  // effect immediately instead of remaining trusted for the JWT's full lifetime.
  const current = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, email: true, name: true, role: true },
  });
  if (!current) throw new Error("UNAUTHORIZED");
  return current;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("FORBIDDEN");
  return user;
}

export async function getUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email: email.toLowerCase() } });
}
