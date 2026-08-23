import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { isDatabaseConfigured, prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type ProbeState = "not_tested" | "ok" | "failed";
type ErrorClass = "auth" | "network" | "configuration" | "runtime" | "unknown" | null;

function classifyError(error: unknown): Exclude<ErrorClass, null> {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (
    message.includes("password authentication failed") ||
    message.includes("authentication failed") ||
    message.includes("28p01") ||
    message.includes("invalid password")
  ) {
    return "auth";
  }

  if (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("connection refused") ||
    message.includes("connection reset") ||
    message.includes("could not connect")
  ) {
    return "network";
  }

  if (
    message.includes("connection string") ||
    message.includes("database url") ||
    message.includes("channel_binding") ||
    message.includes("sslmode") ||
    message.includes("invalid url")
  ) {
    return "configuration";
  }

  if (
    message.includes("workerd") ||
    message.includes("cloudflare") ||
    message.includes("executioncontext") ||
    message.includes("execution context") ||
    message.includes("websocket") ||
    message.includes("socket")
  ) {
    return "runtime";
  }

  return "unknown";
}

export async function GET() {
  let database: "ok" | "not_configured" | "unreachable" = "not_configured";
  let neonHttp: ProbeState = "not_tested";
  let prismaAdapter: ProbeState = "not_tested";
  let prismaTransaction: ProbeState = "not_tested";
  let neonHttpError: ErrorClass = null;
  let prismaAdapterError: ErrorClass = null;
  let prismaTransactionError: ErrorClass = null;

  if (isDatabaseConfigured()) {
    const connectionString = (process.env.DATABASE_URL || "").trim();

    try {
      const sql = neon(connectionString);
      await sql`SELECT 1 AS ok`;
      neonHttp = "ok";
    } catch (error) {
      neonHttp = "failed";
      neonHttpError = classifyError(error);
    }

    try {
      await prisma.$queryRaw`SELECT 1`;
      prismaAdapter = "ok";
    } catch (error) {
      prismaAdapter = "failed";
      prismaAdapterError = classifyError(error);
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1`;
      });
      prismaTransaction = "ok";
    } catch (error) {
      prismaTransaction = "failed";
      prismaTransactionError = classifyError(error);
    }

    database =
      neonHttp === "ok" && prismaAdapter === "ok" && prismaTransaction === "ok"
        ? "ok"
        : "unreachable";
  }

  const ok = database === "ok";

  return NextResponse.json(
    {
      ok,
      service: "dealforge",
      database,
      diagnostics: {
        neonHttp,
        neonHttpError,
        prismaAdapter,
        prismaAdapterError,
        prismaTransaction,
        prismaTransactionError,
      },
      environment: process.env.NODE_ENV ?? "unknown",
      timestamp: new Date().toISOString(),
    },
    {
      status: ok ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
