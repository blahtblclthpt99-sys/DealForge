/**
 * Lazy Prisma access for local Node and Cloudflare Workers.
 *
 * Long-running Node runtimes can safely reuse a singleton client. Cloudflare
 * Workers cannot reuse a database client across requests, so Worker clients are
 * scoped to the current request's ExecutionContext instead of globalThis.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { getCloudflareContext } from "@opennextjs/cloudflare";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

// The WeakMap itself may live for the Worker isolate, but its keys are unique
// per-request ExecutionContext objects and are not retained after the request.
// This preserves a single client within one request (including transactions)
// without leaking the same client into a later request.
const cloudflareRequestClients = new WeakMap<object, PrismaClient>();

function isCloudflareRuntime() {
  return process.env.CLOUDFLARE_WORKERS === "1";
}

export function isDatabaseConfigured() {
  const url = (process.env.DATABASE_URL || "").trim();
  if (!url) return false;

  // Hosted production must use PostgreSQL/Neon. Never allow a local SQLite path
  // to masquerade as a production database on an ephemeral/edge host.
  if (process.env.KOYEB_APP_ID || isCloudflareRuntime()) {
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
  if (isCloudflareRuntime()) {
    const connectionString = (process.env.DATABASE_URL || "").trim();
    if (!connectionString) {
      throw new Error("DATABASE_URL is required in the Cloudflare Workers runtime");
    }
    const adapter = new PrismaNeon({ connectionString });
    return new PrismaClient({ adapter });
  }

  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function getCloudflareRequestClient() {
  const { ctx } = getCloudflareContext();
  const requestKey = ctx as unknown as object;
  const existing = cloudflareRequestClients.get(requestKey);
  if (existing) return existing;

  const client = createClient();
  cloudflareRequestClients.set(requestKey, client);
  return client;
}

export function getPrisma() {
  if (isCloudflareRuntime()) {
    return getCloudflareRequestClient();
  }

  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient();
  }
  return globalForPrisma.prisma;
}

/**
 * Deferred client: first property access resolves the correct client for the
 * current runtime/request. This keeps existing call sites transaction-safe.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrisma();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});
