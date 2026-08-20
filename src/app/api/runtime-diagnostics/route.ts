import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";

function summarize(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return {
    present: text.length > 0,
    postgresScheme: text.startsWith("postgresql://") || text.startsWith("postgres://"),
    length: text.length,
  };
}

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
    },
    {
      headers: {
        "cache-control": "no-store, max-age=0",
        "content-type": "application/json; charset=utf-8",
      },
    },
  );
}
