import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Lightweight per-isolate rate limiting for API routes.
 *
 * This is a bounded abuse-control layer, not a replacement for Cloudflare's
 * distributed rate limiting/WAF. Financial webhooks are intentionally excluded
 * because Stripe delivery must reach the signature-verifying webhook handler.
 */
const hits = new Map<string, { count: number; reset: number }>();
const WINDOW_MS = 60_000;
const DEFAULT_MAX = 120;
const AUTH_MAX = 30;
const CHECKOUT_MAX = 60;
const MAX_TRACKED_KEYS = 10_000;
const SWEEP_EVERY_REQUESTS = 256;
const STRIPE_WEBHOOK_PATH = "/api/stripe/webhook";
let requestsSinceSweep = 0;

function clientIp(req: NextRequest) {
  return (
    req.headers.get("cf-connecting-ip")?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function requestLimit(pathname: string) {
  if (pathname === "/api/auth") return AUTH_MAX;
  if (pathname === "/api/checkout") return CHECKOUT_MAX;
  return DEFAULT_MAX;
}

function purgeExpired(now: number) {
  for (const [key, entry] of hits) {
    if (entry.reset <= now) hits.delete(key);
  }
}

function makeRoom(now: number) {
  purgeExpired(now);
  while (hits.size >= MAX_TRACKED_KEYS) {
    const oldest = hits.keys().next().value as string | undefined;
    if (!oldest) break;
    hits.delete(oldest);
  }
}

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  if (!pathname.startsWith("/api/") || pathname === STRIPE_WEBHOOK_PATH) {
    return NextResponse.next();
  }

  const now = Date.now();
  requestsSinceSweep += 1;
  if (requestsSinceSweep >= SWEEP_EVERY_REQUESTS) {
    purgeExpired(now);
    requestsSinceSweep = 0;
  }

  const ip = clientIp(req);
  const key = `${ip}:${pathname}`;
  const max = requestLimit(pathname);
  const entry = hits.get(key);

  if (!entry || entry.reset <= now) {
    if (!entry && hits.size >= MAX_TRACKED_KEYS) makeRoom(now);
    hits.set(key, { count: 1, reset: now + WINDOW_MS });
    return NextResponse.next();
  }

  entry.count += 1;
  if (entry.count > max) {
    const retryAfter = Math.max(1, Math.ceil((entry.reset - now) / 1000));
    return NextResponse.json(
      { error: "RATE_LIMITED", retryAfterSeconds: retryAfter },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(retryAfter),
        },
      },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
