/**
 * Lazy Prisma client — never construct on import. This keeps local development usable
 * without a hosted database and avoids boot failures when production configuration is missing.
 */
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export function isDatabaseConfigured() {
  const url = (process.env.DATABASE_URL || "").trim();
  if (!url) return false;

  // Koyeb production must use PostgreSQL/Neon. Never allow a local SQLite path to
  // masquerade as a production database because Koyeb's filesystem is ephemeral.
  if (process.env.KOYEB_APP_ID) {
    if (url.startsWith("file:") || url.includes("dev.db") || /sqlite/i.test(url)) {
      return false;
    }
    if (!url.startsWith("postgres://") && !url.startsWith("postgresql://")) {
      return false;
    }
  }

  return true;
}

function createClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export function getPrisma() {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient();
  }
  return globalForPrisma.prisma;
}

/**
 * Deferred client: first property access constructs PrismaClient.
 * Safe to import from layout/auth without a live DATABASE_URL.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrisma();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});
