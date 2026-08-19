/**
 * Cache layer with Redis support and bounded in-memory / DB fallback.
 * Set REDIS_URL to enable Redis (install `ioredis` optionally).
 */

import { prisma } from "./db";

type MemoryEntry = { value: string; expiresAt: number };

const memory = new Map<string, MemoryEntry>();
const MAX_MEMORY_ENTRIES = 500;
const MAX_CACHE_KEY_LENGTH = 512;
const MAX_CACHE_VALUE_CHARS = 1_000_000;
const MIN_TTL_SECONDS = 1;
const MAX_TTL_SECONDS = 86_400;
const DB_PRUNE_INTERVAL_MS = 60_000;
let lastDbPruneAt = 0;

type RedisLike = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, mode: string, ttl: number) => Promise<unknown>;
  del: (key: string) => Promise<unknown>;
};

let redisClient: RedisLike | null = null;
let redisTried = false;

function validKey(key: string) {
  return Boolean(key) && key.length <= MAX_CACHE_KEY_LENGTH;
}

function normalizedTtl(ttlSeconds: number) {
  if (!Number.isFinite(ttlSeconds)) return 300;
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, Math.floor(ttlSeconds)));
}

function pruneMemory(now: number) {
  for (const [key, entry] of memory) {
    if (entry.expiresAt <= now) memory.delete(key);
  }

  while (memory.size >= MAX_MEMORY_ENTRIES) {
    const oldest = memory.keys().next().value as string | undefined;
    if (!oldest) break;
    memory.delete(oldest);
  }
}

async function pruneExpiredDbRows(now: number) {
  if (now - lastDbPruneAt < DB_PRUNE_INTERVAL_MS) return;
  lastDbPruneAt = now;
  try {
    await prisma.cacheEntry.deleteMany({
      where: { expiresAt: { lt: new Date(now) } },
    });
  } catch {
    // DB cache cleanup is best-effort.
  }
}

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
  if (!validKey(key)) return null;

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
        memory.delete(key);
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
  if (!validKey(key)) return;

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return;
  }
  if (serialized.length > MAX_CACHE_VALUE_CHARS) return;

  const ttl = normalizedTtl(ttlSeconds);
  const now = Date.now();
  const expiresAt = now + ttl * 1000;

  const redis = await getRedis();
  if (redis) {
    await redis.set(key, serialized, "EX", ttl);
    return;
  }

  // Refresh insertion order so the Map can act as a simple bounded FIFO/LRU-ish
  // fallback without introducing another dependency.
  memory.delete(key);
  pruneMemory(now);
  memory.set(key, { value: serialized, expiresAt });

  await pruneExpiredDbRows(now);
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
  if (!validKey(key)) return;
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
  const now = Date.now();
  pruneMemory(now);
  await pruneExpiredDbRows(now);

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
