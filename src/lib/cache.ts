/**
 * Cache layer with Redis support and in-memory / DB fallback.
 * Set REDIS_URL to enable Redis (install `ioredis` optionally).
 */

import { prisma } from "./db";

type MemoryEntry = { value: string; expiresAt: number };

const memory = new Map<string, MemoryEntry>();

type RedisLike = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, mode: string, ttl: number) => Promise<unknown>;
  del: (key: string) => Promise<unknown>;
};

let redisClient: RedisLike | null = null;
let redisTried = false;

async function getRedis(): Promise<RedisLike | null> {
  if (redisTried) return redisClient;
  redisTried = true;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    // Optional dependency — resolved at runtime only when REDIS_URL is set
    const mod = "ioredis";
    const { default: Redis } = (await Function(`return import("${mod}")`)()) as {
      default: new (url: string, opts?: object) => RedisLike & { connect: () => Promise<void> };
    };
    const client = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
    await client.connect();
    redisClient = client;
    return redisClient;
  } catch {
    redisClient = null;
    return null;
  }
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = await getRedis();
  if (redis) {
    const raw = await redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  const mem = memory.get(key);
  if (mem) {
    if (mem.expiresAt > Date.now()) {
      try {
        return JSON.parse(mem.value) as T;
      } catch {
        return null;
      }
    }
    memory.delete(key);
  }

  try {
    const row = await prisma.cacheEntry.findUnique({ where: { key } });
    if (!row) return null;
    if (row.expiresAt.getTime() < Date.now()) {
      await prisma.cacheEntry.delete({ where: { key } }).catch(() => undefined);
      return null;
    }
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = 300) {
  const serialized = JSON.stringify(value);
  const expiresAt = Date.now() + ttlSeconds * 1000;

  const redis = await getRedis();
  if (redis) {
    await redis.set(key, serialized, "EX", ttlSeconds);
    return;
  }

  memory.set(key, { value: serialized, expiresAt });

  try {
    await prisma.cacheEntry.upsert({
      where: { key },
      create: { key, value: serialized, expiresAt: new Date(expiresAt) },
      update: { value: serialized, expiresAt: new Date(expiresAt) },
    });
  } catch {
    // DB cache is best-effort
  }
}

export async function cacheDel(key: string) {
  memory.delete(key);
  const redis = await getRedis();
  if (redis) await redis.del(key);
  try {
    await prisma.cacheEntry.delete({ where: { key } });
  } catch {
    // ignore
  }
}

export async function cacheStatus() {
  const redis = await getRedis();
  const memKeys = memory.size;
  let dbKeys = 0;
  try {
    dbKeys = await prisma.cacheEntry.count();
  } catch {
    dbKeys = 0;
  }
  return {
    backend: redis ? "redis" : "memory+db",
    memoryKeys: memKeys,
    dbKeys,
    redisConnected: Boolean(redis),
  };
}
