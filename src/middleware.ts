import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Best-effort per-isolate API throttling.
 *
 * This protects an individual runtime instance from obvious bursts but is not a
 * globally consistent distributed rate-limit. Cloudflare production prefers
 * CF-Connecting-IP (set by the platform) over caller-influenced forwarding
 * headers. A shared Cloudflare Rate Limiting binding can replace this map when
 * stronger account-wide enforcement is required.
 */
const hits = new Map<string, { count: number; reset: number }>();
const WINDOW_MS = 60_000;
const GENERAL_MAX = 120;
const AUTH_MAX = 20;
const MAX_TRACKED_KEYS = 5_000;
let lastPruneAt = 0;

function pruneExpired(now: number) {
  if (now - lastPruneAt < WINDOW_MS && hits.size < MAX_TRACKED_KEYS) return;
  lastPruneAt = now;

  for (const [key, entry] of hits) {
    if (entry.reset <= now) hits.delete(key);
  }

  // Map iteration order is insertion order, so evict the oldest keys if a
  // single isolate sees highly variable client identifiers.
  while (hits.size >= MAX_TRACKED_KEYS) {
    const oldest = hits.keys().next().value as string | undefined;
    if (!oldest) break;
    hits.delete(oldest);
  }
}

function clientIp(req: NextRequest) {
  const cloudflareIp = req.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareIp) return cloudflareIp;

  const forwardedIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedIp || "local";
}

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const key = `${clientIp(req)}:${pathname}`;
  const now = Date.now();
  pruneExpired(now);

  const max = pathname === "/api/auth" ? AUTH_MAX : GENERAL_MAX;
  const entry = hits.get(key);

  if (!entry || entry.reset <= now) {
    hits.set(key, { count: 1, reset: now + WINDOW_MS });
    return NextResponse.next();
  }

  entry.count += 1;
  if (entry.count > max) {
    const retryAfter = Math.max(1, Math.ceil((entry.reset - now) / 1000));
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again shortly." },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
