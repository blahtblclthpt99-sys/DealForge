import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Best-effort per-isolate API throttling plus browser-origin enforcement.
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
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const PRIVATE_API_PREFIXES = [
  "/api/auth",
  "/api/account",
  "/api/wishlist",
  "/api/saved-searches",
  "/api/price-alerts",
  "/api/admin",
] as const;
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

function browserFacingOrigins(req: NextRequest) {
  const origins = new Set<string>();
  const host = req.headers.get("host")?.trim().toLowerCase();
  if (host) {
    const protocol = req.nextUrl.protocol === "https:" ? "https:" : "http:";
    origins.add(`${protocol}//${host}`);
  }

  // The canonical configured app URL is a second trusted representation for
  // reverse-proxy deployments where the framework's internal URL differs from
  // the externally visible request URL.
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    try {
      origins.add(new URL(configured).origin.toLowerCase());
    } catch {
      // Invalid configuration must not weaken the request-origin check.
    }
  }

  return origins;
}

function browserOriginAllowed(req: NextRequest) {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return true;

  // Fetch Metadata catches ordinary cross-site browser requests. Origin is the
  // stronger check for same-site sibling subdomains, because SameSite cookies
  // alone do not distinguish those origins.
  if (req.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    return false;
  }

  const origin = req.headers.get("origin");
  if (!origin) {
    // Non-browser clients and the signed internal maintenance dispatch may omit
    // Origin. Route-level authentication still applies to protected endpoints.
    return true;
  }

  try {
    const normalizedOrigin = new URL(origin).origin.toLowerCase();
    return browserFacingOrigins(req).has(normalizedOrigin);
  } catch {
    return false;
  }
}

function isPrivateApi(pathname: string) {
  return PRIVATE_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function nextApiResponse(pathname: string) {
  const response = NextResponse.next();
  if (isPrivateApi(pathname)) {
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
  }
  return response;
}

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (!browserOriginAllowed(req)) {
    return NextResponse.json(
      { error: "Cross-origin request blocked" },
      {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const key = `${clientIp(req)}:${pathname}`;
  const now = Date.now();
  pruneExpired(now);

  const max = pathname === "/api/auth" ? AUTH_MAX : GENERAL_MAX;
  const entry = hits.get(key);

  if (!entry || entry.reset <= now) {
    hits.set(key, { count: 1, reset: now + WINDOW_MS });
    return nextApiResponse(pathname);
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

  return nextApiResponse(pathname);
}

export const config = {
  matcher: ["/api/:path*"],
};
