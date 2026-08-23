/**
 * Lazy Prisma access for local Node and Cloudflare Workers.
 *
 * The PostgreSQL client is generated with Prisma's JS engine so it can run in
 * workerd. That engine always requires a driver adapter, including during Node
 * execution. Cloudflare request clients are scoped to the current
 * ExecutionContext so WebSocket-backed transactions never leak across requests.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import { getCloudflareContext } from "@opennextjs/cloudflare";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const cloudflareRequestClients = new WeakMap<object, PrismaClient>();

type CloudflareContext = ReturnType<typeof getCloudflareContext>;

function tryGetCloudflareContext(): CloudflareContext | null {
  try {
    return getCloudflareContext();
  } catch {
    return null;
  }
}

function isCloudflareRuntime() {
  return process.env.CLOUDFLARE_WORKERS === "1" || tryGetCloudflareContext() !== null;
}

function configureNeonRuntime() {
  // Ordinary Pool.query() calls can use Neon's fetch transport. This avoids an
  // unnecessary WebSocket for one-shot Prisma reads/writes and is supported by
  // @neondatabase/serverless in Cloudflare Workers.
  neonConfig.poolQueryViaFetch = true;

  // Interactive transactions still require a session, so PrismaNeon uses
  // Pool.connect() over WebSockets for those. Bind the runtime constructor
  // explicitly when the platform provides it.
  if (typeof globalThis.WebSocket !== "undefined") {
    neonConfig.webSocketConstructor = globalThis.WebSocket;
  }
}

function databaseUrl() {
  return (process.env.DATABASE_URL || "").trim();
}

function isPostgresUrl(url: string) {
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

export function isDatabaseConfigured() {
  const url = databaseUrl();
  if (!url) return false;

  if (process.env.VERCEL === "1" || process.env.KOYEB_APP_ID || isCloudflareRuntime()) {
    if (url.startsWith("file:") || url.includes("dev.db") || /sqlite/i.test(url)) {
      return false;
    }
    if (!isPostgresUrl(url)) return false;
  }

  return true;
}

function createClient() {
  const url = databaseUrl();
  if (isPostgresUrl(url)) {
    configureNeonRuntime();
    const adapter = new PrismaNeon({ connectionString: url });
    return new PrismaClient({ adapter });
  }

  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function getCloudflareRequestClient(): PrismaClient | null {
  const cloudflare = tryGetCloudflareContext();
  if (!cloudflare) return null;

  const requestKey = cloudflare.ctx as unknown as object;
  const existing = cloudflareRequestClients.get(requestKey);
  if (existing) return existing;

  const client = createClient();
  cloudflareRequestClients.set(requestKey, client);
  return client;
}

export function getPrisma() {
  const cloudflareClient = getCloudflareRequestClient();
  if (cloudflareClient) return cloudflareClient;

  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient();
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
