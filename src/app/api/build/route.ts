import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// NEXT_PUBLIC_BUILD_SHA is injected at build time. Cloudflare Workers Builds
// provides WORKERS_CI_COMMIT_SHA to the build process; GitHub CI falls back to
// GITHUB_SHA. Exposing a commit hash is safe and lets live smoke tests prove
// they are certifying the exact deployed revision rather than an older Worker.
const BUILD_SHA = process.env.NEXT_PUBLIC_BUILD_SHA?.trim() || "unknown";

export async function GET() {
  return NextResponse.json(
    { sha: BUILD_SHA },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
