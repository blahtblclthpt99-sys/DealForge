import { NextRequest, NextResponse } from "next/server";

const ALLOWED =
  /^(https:\/\/)(m\.media-amazon\.com|images-na\.ssl-images-amazon\.com|ws-na\.amazon-adsystem\.com)\//i;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("u") || "";
  let url: string;
  try {
    url = decodeURIComponent(raw);
  } catch {
    return new NextResponse("Bad URL", { status: 400 });
  }

  if (!ALLOWED.test(url)) {
    return new NextResponse("Host not allowed", { status: 400 });
  }

  const q = url.indexOf("?");
  const path = q >= 0 ? url.slice(0, q) : url;
  const qs = q >= 0 ? url.slice(q) : "";
  url = path.replace(/\+/g, "%2B") + qs;

  try {
    const upstream = await fetch(url, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
      // Cache at the platform fetch layer when available
      next: { revalidate: 60 * 60 * 24 * 14 },
    });

    if (!upstream.ok || !upstream.body) {
      return new NextResponse("Upstream error", { status: upstream.status || 502 });
    }

    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400, immutable",
      },
    });
  } catch {
    return new NextResponse("Fetch failed", { status: 502 });
  }
}
