import { adsensePublisherId, normalizeAdsenseClient } from "@/lib/ads";

export const dynamic = "force-dynamic";

export function GET() {
  const client = normalizeAdsenseClient();
  const publisher = client ? adsensePublisherId(client) : null;
  const body = publisher
    ? `google.com, ${publisher}, DIRECT, f08c47fec0942fa0\n`
    : "# AdSense publisher ID is not configured.\n";

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
