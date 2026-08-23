import { NextResponse } from "next/server";
import { isDatabaseConfigured, prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  let database: "ok" | "not_configured" | "unreachable" = "not_configured";

  if (isDatabaseConfigured()) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      database = "ok";
    } catch {
      database = "unreachable";
    }
  }

  const ok = database === "ok";

  return NextResponse.json(
    {
      ok,
      service: "dealforge",
      database,
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
