/**
 * Re-fetch correct Amazon images for curated / known-bad ASINs.
 */
import { PrismaClient } from "@prisma/client";
import { normalizeProductImage } from "../src/lib/product-image";

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const ASINS = [
  "B0DLFMFBJW",
  "B00ZV9RDKK",
  "B0BFC7WQ6R",
  "B09XS7JWHH",
  "B08C1W5N87",
  "B09B8V1LZ3",
  "B08L5M9BTJ",
  "B08GYKNCCP",
  "B09V3HN1KC",
  "B07FZ8S74R",
  "B07VP37KMB",
  "B00006JSUA",
  "B00FLYWNYQ",
  "B01N1UX8RW",
  "B01AVDVHTI",
  "B003VWKPHC",
  "B08KRV7S22",
  "B01N5IB20Q",
  "B00CFM0P7Y",
  "B01LYCLS24",
  "B00NGV4506",
  "B074PVTPBW",
  "B09JQMJHXY",
  "B01M1EXQY4",
  "B0DZM1WVCS",
  "B0DYLG399L",
  "B01BA54YGO",
  "B0FD8D9NJF",
  "B0CRH74TD6",
];

async function scrape(asin: string) {
  const r = await fetch(`https://www.amazon.com/gp/aw/d/${asin}`, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
    redirect: "follow",
  });
  const html = await r.text();
  if (/captcha|robot check|page not found/i.test(html.slice(0, 4000))) return null;
  const img =
    html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1] ||
    html.match(/"hiRes":"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/)?.[1]?.replace(
      /\\u002F/g,
      "/",
    ) ||
    html.match(/(https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9+\-_%,.]{10,})/)?.[1];
  return img ? normalizeProductImage(img) : null;
}

async function main() {
  const prisma = new PrismaClient();
  let fixed = 0;
  for (const asin of ASINS) {
    const row = await prisma.product.findFirst({ where: { asin } });
    if (!row) {
      console.log("skip", asin);
      continue;
    }
    const img = await scrape(asin);
    await new Promise((r) => setTimeout(r, 1200));
    if (!img) {
      console.log("FAIL", asin);
      continue;
    }
    await prisma.product.update({
      where: { id: row.id },
      data: { images: JSON.stringify([img]) },
    });
    fixed++;
    console.log("OK", asin, img.slice(0, 80));
  }
  await prisma.cacheEntry.deleteMany();
  console.log(`fixed ${fixed}/${ASINS.length}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
