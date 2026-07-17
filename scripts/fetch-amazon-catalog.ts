/**
 * Fetch live Amazon product title + image for known ASINs.
 * Output: prisma/amazon-catalog.json
 */
const CANDIDATES: { asin: string; category: string }[] = [
  { asin: "B09XS7JWHH", category: "electronics" },
  { asin: "B08C1W5N87", category: "electronics" },
  { asin: "B09B8V1LZ3", category: "electronics" },
  { asin: "B08L5M9BTJ", category: "electronics" },
  { asin: "B08GYKNCCP", category: "electronics" },
  { asin: "B09V3HN1KC", category: "electronics" },
  { asin: "B07FZ8S74R", category: "electronics" },
  { asin: "B09G9FPHY6", category: "electronics" },
  { asin: "B08N5WRWNW", category: "electronics" },
  { asin: "B0BDHB9Y8H", category: "electronics" },
  { asin: "B00006JSUA", category: "home-kitchen" },
  { asin: "B00FLYWNYQ", category: "home-kitchen" },
  { asin: "B07W5B3K3K", category: "home-kitchen" },
  { asin: "B08L7XG9MK", category: "tools" },
  { asin: "B08GKZ3X9K", category: "tools" },
  { asin: "B07S9H4QTF", category: "automotive" },
  { asin: "B08F7PTF54", category: "gaming" },
  { asin: "B0B7QJ6V8N", category: "gaming" },
  { asin: "B07VP37KMB", category: "electronics" },
  { asin: "B08CF3XY9C", category: "clothing" },
  { asin: "B00I0B8B5A", category: "beauty" },
  { asin: "B01N1UX8RW", category: "sports" },
  { asin: "B01AVDVHTI", category: "sports" },
  { asin: "B07VD9X67M", category: "pet-supplies" },
  { asin: "B07S65MX2B", category: "office" },
  { asin: "B07Q32B5XD", category: "outdoor" },
  { asin: "B07PGL2WZQ", category: "outdoor" },
  { asin: "B08GJ2Y4YQ", category: "toys" },
  { asin: "B00BW6LCP2", category: "grocery" },
  { asin: "B00XVYVKGY", category: "books" },
  { asin: "B08PPDJWCX", category: "electronics" },
  { asin: "B07RX6G8ZG", category: "sports" },
  { asin: "B09B8YRMT4", category: "home-kitchen" },
  { asin: "B0C1H26C1P", category: "electronics" },
  { asin: "B0CX23V2ZK", category: "beauty" },
  { asin: "B0CR4Y7K2G", category: "outdoor" },
];

function pickImage(html: string) {
  const patterns = [
    /property="og:image"\s+content="([^"]+)"/i,
    /content="([^"]+)"\s+property="og:image"/i,
    /"hiRes":"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/,
    /"large":"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/,
    /(https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9+\-_%,.]+)/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]?.includes("/images/I/")) return m[1].replace(/\\u002F/g, "/");
  }
  return null;
}

function pickTitle(html: string) {
  const m =
    html.match(/property="og:title"\s+content="([^"]+)"/i) ||
    html.match(/content="([^"]+)"\s+property="og:title"/i);
  if (!m?.[1]) return null;
  return m[1]
    .replace(/&amp;/g, "&")
    .replace(/\s*[|:].*Amazon.*$/i, "")
    .replace(/^Amazon\.com:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pickBrand(html: string, title: string) {
  const m =
    html.match(/id="bylineInfo"[^>]*>\s*(?:Visit the|Brand:)\s*([^<]+)/i) ||
    html.match(/"brand"\s*:\s*"([^"]+)"/i);
  if (m?.[1]) return m[1].replace(/Store$/i, "").trim();
  return title.split(/\s+/)[0] || "Amazon";
}

async function main() {
  const results: Array<{
    asin: string;
    category: string;
    title: string;
    brand: string;
    image: string;
  }> = [];

  for (const item of CANDIDATES) {
    try {
      const r = await fetch(`https://www.amazon.com/dp/${item.asin}`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
          Accept: "text/html",
        },
        redirect: "follow",
      });
      const html = await r.text();
      const title = pickTitle(html);
      const image = pickImage(html);
      if (!title || /page not found/i.test(title) || !image) {
        console.log(`skip ${item.asin}`);
        continue;
      }
      results.push({
        asin: item.asin,
        category: item.category,
        title: title.slice(0, 160),
        brand: pickBrand(html, title),
        image,
      });
      console.log(`ok ${item.asin} → ${title.slice(0, 60)}`);
    } catch (e) {
      console.log(`err ${item.asin}`, e);
    }
  }

  const fs = await import("fs");
  fs.writeFileSync("prisma/amazon-catalog.json", JSON.stringify(results, null, 2));
  console.log(`Wrote ${results.length} products`);
}

main();
