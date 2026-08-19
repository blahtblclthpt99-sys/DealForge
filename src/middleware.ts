import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Lightweight single-instance rate limiting for API routes.
 * Koyeb Free runs one web instance, so this provides a useful local guard.
 * If DealForge scales horizontally later, move counters to shared storage.
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

  // Hard bound protects the small Koyeb instance even if client IP headers are
  // highly variable. Map iteration order is insertion order, so evict oldest.
  while (hits.size >= MAX_TRACKED_KEYS) {
    const oldest = hits.keys().next().value as string | undefined;
    if (!oldest) break;
    hits.delete(oldest);
  }
}

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key = `${ip}:${pathname}`;
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
