/**
 * Lazy Prisma access for local Node and Cloudflare Workers.
 *
 * The PostgreSQL client is generated with Prisma's JS engine so it can run in
 * workerd. That engine always requires a driver adapter, including during Node
 * execution. Cloudflare request clients are additionally scoped to the current
 * ExecutionContext so they are never leaked across requests.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import { getCloudflareContext } from "@opennextjs/cloudflare";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const cloudflareRequestClients = new WeakMap<object, PrismaClient>();

function isCloudflareRuntime() {
  return process.env.CLOUDFLARE_WORKERS === "1";
}

function configureNeonRuntime() {
  if (!isCloudflareRuntime()) return;

  // Pool.query() is safe to route over Neon's HTTP transport for ordinary
  // one-shot Prisma queries. Interactive transactions still use WebSockets.
  neonConfig.poolQueryViaFetch = true;

  // OpenNext runs with nodejs_compat, but Cloudflare also exposes the standard
  // WebSocket constructor. Bind it explicitly so PrismaNeon's Pool.connect()
  // path can establish transaction-scoped WebSocket sessions reliably.
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

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrisma();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});
