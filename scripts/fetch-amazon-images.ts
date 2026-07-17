/**
 * One-time helper: resolve Amazon product image URLs for seed ASINs.
 * Uses product page metadata when available; falls back to ASIN image pattern.
 */
const ASINs = [
  "B09XS7JWHH",
  "B0B1N5FHP2",
  "B09JPCM59J",
  "B08C1W5N87",
  "B00006JSUA",
  "B00FLYWNYQ",
  "B07FZ8S74R",
  "B08GYKNCCP",
  "B07GXZ7R65",
  "B07S9H4QTF",
  "B08L5M9BTJ",
  "B08F7PTF54",
  "B09V3HN1KC",
  "B07VP37KMB",
  "B08CF3XY9C",
  "B00I0B8B5A",
  "B01N1UX8RW",
  "B07VD9X67M",
  "B08G4KN5GH",
  "B07YQK9Y8Z",
  "B07S65MX2B",
  "B07Q32B5XD",
  "B07PGL2WZQ",
  "B01AVDVHTI",
  "B08GJ2Y4YQ",
  "B00BW6LCP2",
  "B00XVYVKGY",
  "B09B8V1LZ3",
  "B08PPDJWCX",
  "B07RX6G8ZG",
  "B08CFSZLQF",
  "B07YWWXFVC",
];

function pickImage(html: string) {
  const patterns = [
    /property="og:image"\s+content="([^"]+)"/i,
    /content="([^"]+)"\s+property="og:image"/i,
    /"hiRes":"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/,
    /"large":"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/,
    /"mainUrl":"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/,
    /(https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9+\-_%,.]+)/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1].replace(/\\u002F/g, "/");
  }
  return null;
}

function pickTitle(html: string) {
  const m =
    html.match(/property="og:title"\s+content="([^"]+)"/i) ||
    html.match(/content="([^"]+)"\s+property="og:title"/i) ||
    html.match(/<title>([^<]+)<\/title>/i);
  return m?.[1]?.replace(/\s+/g, " ").trim() ?? null;
}

async function imageLooksValid(url: string) {
  try {
    const r = await fetch(url, { method: "HEAD", redirect: "follow" });
    const len = Number(r.headers.get("content-length") || 0);
    const type = r.headers.get("content-type") || "";
    return r.ok && type.includes("image") && len > 1000;
  } catch {
    return false;
  }
}

async function main() {
  const out: Record<string, { title?: string | null; image?: string | null }> = {};
  for (const asin of ASINs) {
    const fallback = `https://m.media-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_SX500_.jpg`;
    let image: string | null = null;
    let title: string | null = null;
    try {
      const r = await fetch(`https://www.amazon.com/dp/${asin}`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
      });
      const html = await r.text();
      title = pickTitle(html);
      image = pickImage(html);
      console.log(`${asin} fetch=${r.status} title=${title ? "yes" : "no"} img=${image ? "yes" : "no"}`);
    } catch (e) {
      console.log(`${asin} fetch error`, e);
    }

    if (!image || !(await imageLooksValid(image))) {
      if (await imageLooksValid(fallback)) image = fallback;
      else image = fallback;
    }

    out[asin] = { title, image };
  }

  const fs = await import("fs");
  fs.writeFileSync("prisma/amazon-images.json", JSON.stringify(out, null, 2));
  console.log("Wrote prisma/amazon-images.json");
}

main();
