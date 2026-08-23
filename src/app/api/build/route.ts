import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Injected at build time by cf:build. Exposing a commit hash is safe and lets
// transaction certification prove it is testing the exact deployed revision.
const BUILD_SHA = process.env.NEXT_PUBLIC_BUILD_SHA?.trim() || "unknown";

export async function GET() {
  return NextResponse.json(
    { sha: BUILD_SHA },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
