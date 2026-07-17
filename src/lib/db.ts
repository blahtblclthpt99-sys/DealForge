import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaReady?: boolean;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/** Tune SQLite for faster reads on larger catalogs. */
export async function ensureDbPerformance() {
  if (globalForPrisma.prismaReady) return;
  try {
    await prisma.$executeRawUnsafe("PRAGMA journal_mode = WAL;");
    await prisma.$executeRawUnsafe("PRAGMA synchronous = NORMAL;");
    await prisma.$executeRawUnsafe("PRAGMA temp_store = MEMORY;");
    await prisma.$executeRawUnsafe("PRAGMA cache_size = -64000;");
    await prisma.$executeRawUnsafe("PRAGMA mmap_size = 268435456;");
    globalForPrisma.prismaReady = true;
  } catch {
    // best-effort — ignore if provider doesn't support these
  }
}

void ensureDbPerformance();
