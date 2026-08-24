import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { pauseUnsafeCommerceProducts } from "@/lib/commerce-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_HEADER = "x-dealforge-maintenance-token";

function maintenanceToken() {
  return (process.env.MAINTENANCE_TOKEN || process.env.AUTH_SECRET || "").trim();
}

function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(request: Request) {
  const expected = maintenanceToken();
  const supplied = (request.headers.get(TOKEN_HEADER) || "").trim();
  return expected.length >= 24 && supplied.length === expected.length && constantTimeEqual(supplied, expected);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json(
      { error: "UNAUTHORIZED" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await pauseUnsafeCommerceProducts("cloudflare-cron");
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("commerce.monitor.failed", {
      error: error instanceof Error ? error.message : "UNKNOWN",
    });
    return NextResponse.json(
      { error: "COMMERCE_MONITOR_FAILED" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
