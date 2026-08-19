import { NextRequest, NextResponse } from "next/server";

const ALLOWED_HOSTS = new Set([
  "m.media-amazon.com",
  "images-na.ssl-images-amazon.com",
  "ws-na.amazon-adsystem.com",
]);
const MAX_REDIRECTS = 2;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function allowedUrl(value: string, base?: URL): URL | null {
  try {
    const url = base ? new URL(value, base) : new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (url.port && url.port !== "443") return null;
    if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

async function fetchAllowedImage(initial: URL) {
  let current = initial;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
      redirect: "manual",
      next: { revalidate: 60 * 60 * 24 * 14 },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || hop === MAX_REDIRECTS) return null;
      const redirected = allowedUrl(location, current);
      if (!redirected) return null;
      current = redirected;
      continue;
    }

    return response;
  }

  return null;
}

async function readBoundedBody(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function GET(req: NextRequest) {
  // URLSearchParams already decodes the query value once. Do not decode it again.
  const raw = req.nextUrl.searchParams.get("u") || "";
  const url = allowedUrl(raw);
  if (!url) {
    return new NextResponse("Host not allowed", { status: 400 });
  }

  // Preserve literal plus characters in Amazon object keys.
  url.pathname = url.pathname.replace(/\+/g, "%2B");

  try {
    const upstream = await fetchAllowedImage(url);
    if (!upstream) {
      return new NextResponse("Redirect not allowed", { status: 502 });
    }
    if (!upstream.ok || !upstream.body) {
      return new NextResponse("Upstream error", { status: upstream.status || 502 });
    }

    const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/")) {
      await upstream.body.cancel();
      return new NextResponse("Unsupported upstream content", { status: 415 });
    }

    const declaredLength = Number(upstream.headers.get("content-length") || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
      await upstream.body.cancel();
      return new NextResponse("Image too large", { status: 413 });
    }

    const body = await readBoundedBody(upstream.body);
    if (!body) {
      return new NextResponse("Image too large", { status: 413 });
    }

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(body.byteLength),
        "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Fetch failed", { status: 502 });
  }
}
