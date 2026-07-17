/**
 * Fix products that currently use placeholder images by scraping Amazon og:image.
 */
import { PrismaClient } from "@prisma/client";
import { normalizeProductImage } from "../src/lib/product-image";

const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const UA_DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function isBadImage(url: string) {
  if (!url) return true;
  if (url.includes("placeholder")) return true;
  if (url.startsWith("/products/")) return true;
  if (/\/I\/[A-Za-z0-9]+\._RC/i.test(url)) return true;
  if (/sprite|transparent-pixel/i.test(url)) return true;
  return false;
}

async function scrapeImage(asin: string): Promise<string | null> {
  const attempts = [
    { url: `https://www.amazon.com/gp/aw/d/${asin}`, ua: UA_MOBILE },
    { url: `https://www.amazon.com/dp/${asin}`, ua: UA_DESKTOP },
  ];

  for (const attempt of attempts) {
    try {
      const r = await fetch(attempt.url, {
        headers: {
          "User-Agent": attempt.ua,
          "Accept-Language": "en-US,en;q=0.9",
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
      });
      const html = await r.text();
      if (/captcha|robot check|automated access/i.test(html.slice(0, 5000))) continue;
      if (/page not found|dogs of Amazon/i.test(html)) return null;

      const raw =
        html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1] ||
        html.match(/content="([^"]+)"\s+property="og:image"/i)?.[1] ||
        html.match(/"hiRes":"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/)?.[1]?.replace(
          /\\u002F/g,
          "/",
        ) ||
        html.match(/"large":"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/)?.[1]?.replace(
          /\\u002F/g,
          "/",
        ) ||
        html.match(/(https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9+\-_%,.]{10,})/)?.[1];

      if (!raw) continue;
      const img = normalizeProductImage(raw);
      if (!isBadImage(img)) return img;
    } catch {
      /* try next */
    }
  }

  // Last resort: Amazon ASIN image pattern
  const fallback = `https://m.media-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_SX500_.jpg`;
  return fallback;
}

async function imageLooksOk(url: string) {
  try {
    const r = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": UA_MOBILE, Referer: "" },
      redirect: "follow",
    });
    const type = r.headers.get("content-type") || "";
    const len = Number(r.headers.get("content-length") || 0);
    try {
      await r.body?.cancel();
    } catch {
      /* ignore */
    }
    if (!r.ok) return false;
    if (type && !type.includes("image")) return false;
    if (len > 0 && len < 800) return false;
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const prisma = new PrismaClient();
  const rows = await prisma.product.findMany({
    where: {
      retailer: "amazon",
      asin: { not: null },
      OR: [{ images: { contains: "placeholder" } }, { images: { equals: "[]" } }, { images: { equals: "" } }],
    },
    select: { id: true, asin: true, title: true, images: true },
  });

  console.log(`Fixing ${rows.length} products with missing images…`);
  let fixed = 0;
  let failed = 0;

  for (const row of rows) {
    const asin = row.asin!;
    let img = await scrapeImage(asin);
    if (img && !(await imageLooksOk(img))) {
      // try ASIN pattern if og:image failed validation
      const fallback = `https://m.media-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_SX500_.jpg`;
      if (await imageLooksOk(fallback)) img = fallback;
      else img = null;
    }

    if (!img || isBadImage(img)) {
      failed++;
      console.log(`FAIL  ${asin}  ${row.title.slice(0, 50)}`);
      await sleep(1500);
      continue;
    }

    await prisma.product.update({
      where: { id: row.id },
      data: { images: JSON.stringify([img]) },
    });
    fixed++;
    console.log(`OK    ${asin}  ${img.slice(0, 70)}`);
    await sleep(1200 + Math.random() * 800);
  }

  await prisma.cacheEntry.deleteMany();
  console.log(`\nfixed=${fixed} failed=${failed}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
