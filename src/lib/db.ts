/**
 * Lazy Prisma access for local Node and Cloudflare Workers.
 *
 * Node runtimes can reuse a singleton Prisma client. Cloudflare Workers use
 * the Neon driver adapter and scope the client to the current request context
 * so a database client is never leaked across requests.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { getCloudflareContext } from "@opennextjs/cloudflare";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const cloudflareRequestClients = new WeakMap<object, PrismaClient>();

function isCloudflareRuntime() {
  return process.env.CLOUDFLARE_WORKERS === "1";
}

export function isDatabaseConfigured() {
  const url = (process.env.DATABASE_URL || "").trim();
  if (!url) return false;

  if (process.env.VERCEL === "1" || process.env.KOYEB_APP_ID || isCloudflareRuntime()) {
    if (url.startsWith("file:") || url.includes("dev.db") || /sqlite/i.test(url)) {
      return false;
    }
    if (!url.startsWith("postgres://") && !url.startsWith("postgresql://")) {
      return false;
    }
  }

  return true;
}

function createNodeClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function createCloudflareClient() {
  const connectionString = (process.env.DATABASE_URL || "").trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is required in the Cloudflare Workers runtime");
  }
  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({ adapter });
}

function getCloudflareRequestClient() {
  const { ctx } = getCloudflareContext();
  const requestKey = ctx as unknown as object;
  const existing = cloudflareRequestClients.get(requestKey);
  if (existing) return existing;

  const client = createCloudflareClient();
  cloudflareRequestClients.set(requestKey, client);
  return client;
}

export function getPrisma() {
  if (isCloudflareRuntime()) {
    return getCloudflareRequestClient();
  }

  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createNodeClient();
  }
  return globalForPrisma.prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrisma();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});
