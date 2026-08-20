import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { getCategories } from "@/lib/products";

export const dynamic = "force-dynamic";

function summarize(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return {
    present: text.length > 0,
    postgresScheme: text.startsWith("postgresql://") || text.startsWith("postgres://"),
    length: text.length,
  };
}

function safeError(error: unknown) {
  const name = error instanceof Error ? error.name : "unknown";
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgresql://[redacted]@")
    .slice(0, 500);
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "") || null
      : null;
  return { name, code, message };
}

type Probe = {
  attempted: boolean;
  ok: boolean;
  count?: number;
  error: ReturnType<typeof safeError> | null;
};

export async function GET() {
  const processDatabaseUrl = process.env.DATABASE_URL;
  const processAuthSecret = process.env.AUTH_SECRET;
  const processCloudflareWorkers = process.env.CLOUDFLARE_WORKERS;

  let contextAvailable = false;
  let contextError: string | null = null;
  let contextDatabaseUrl: unknown;
  let contextAuthSecret: unknown;
  let contextCloudflareWorkers: unknown;

  try {
    const { env } = getCloudflareContext();
    const bindings = env as unknown as Record<string, unknown>;
    contextAvailable = true;
    contextDatabaseUrl = bindings.DATABASE_URL;
    contextAuthSecret = bindings.AUTH_SECRET;
    contextCloudflareWorkers = bindings.CLOUDFLARE_WORKERS;
  } catch (error) {
    contextError = error instanceof Error ? error.name : "unknown";
  }

  const databaseUrl =
    typeof contextDatabaseUrl === "string" && contextDatabaseUrl.trim()
      ? contextDatabaseUrl.trim()
      : (processDatabaseUrl || "").trim();

  const databaseProbe: Probe = { attempted: false, ok: false, error: null };
  const freshCategoryProbe: Probe = { attempted: false, ok: false, error: null };
  const appCategoryProbe: Probe = { attempted: true, ok: false, error: null };

  if (databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://")) {
    databaseProbe.attempted = true;
    freshCategoryProbe.attempted = true;
    let prisma: PrismaClient | null = null;
    try {
      const adapter = new PrismaNeon({ connectionString: databaseUrl });
      prisma = new PrismaClient({ adapter });
      await prisma.$queryRaw`SELECT 1`;
      databaseProbe.ok = true;
      const categories = await prisma.category.findMany({
        orderBy: { name: "asc" },
        include: { _count: { select: { products: true } } },
      });
      freshCategoryProbe.ok = true;
      freshCategoryProbe.count = categories.length;
    } catch (error) {
      const sanitized = safeError(error);
      if (!databaseProbe.ok) databaseProbe.error = sanitized;
      else freshCategoryProbe.error = sanitized;
    } finally {
      if (prisma) {
        try {
          await prisma.$disconnect();
        } catch {
          // Diagnostic cleanup only; do not hide the query result.
        }
      }
    }
  }

  try {
    const categories = await getCategories();
    appCategoryProbe.ok = true;
    appCategoryProbe.count = categories.length;
  } catch (error) {
    appCategoryProbe.error = safeError(error);
  }

  return Response.json(
    {
      ok: true,
      processEnv: {
        databaseUrl: summarize(processDatabaseUrl),
        authSecret: {
          present: typeof processAuthSecret === "string" && processAuthSecret.length > 0,
          lengthOk: typeof processAuthSecret === "string" && processAuthSecret.length >= 32,
        },
        cloudflareWorkers: processCloudflareWorkers ?? null,
      },
      cloudflareContext: {
        available: contextAvailable,
        error: contextError,
        databaseUrl: summarize(contextDatabaseUrl),
        authSecret: {
          present: typeof contextAuthSecret === "string" && contextAuthSecret.length > 0,
          lengthOk: typeof contextAuthSecret === "string" && contextAuthSecret.length >= 32,
        },
        cloudflareWorkers:
          typeof contextCloudflareWorkers === "string" ? contextCloudflareWorkers : null,
      },
      databaseProbe,
      freshCategoryProbe,
      appCategoryProbe,
    },
    {
      headers: {
        "cache-control": "no-store, max-age=0",
        "content-type": "application/json; charset=utf-8",
      },
    },
  );
}
