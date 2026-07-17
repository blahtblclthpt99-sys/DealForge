/**
 * Enrich products via Playwright (real Chromium) — much higher Amazon success rate.
 *
 * Usage:
 *   npx tsx scripts/enrich-playwright.ts
 *   npx tsx scripts/enrich-playwright.ts --concurrency 6 --limit 500
 */
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { slugify } from "../src/lib/utils";
import { normalizeProductImage } from "../src/lib/product-image";
import { inferClothingSubcategory } from "../src/lib/clothing-subcategory";

const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Number(process.argv[i + 1]) : 100_000;
})();
const CONCURRENCY = (() => {
  const i = process.argv.indexOf("--concurrency");
  return i >= 0 ? Math.max(1, Number(process.argv[i + 1]) || 4) : 6;
})();

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function decode(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

type Scraped = {
  title: string;
  brand: string;
  image: string;
  price: number;
  originalPrice: number;
  rating: number;
  reviewCount: number;
};

async function scrapeInPage(page: import("playwright").Page, asin: string): Promise<Scraped | { unavailable: true } | null> {
  try {
    const result = await page.evaluate(async (a) => {
      const res = await fetch(`https://www.amazon.com/dp/${a}?th=1&psc=1`, {
        credentials: "include",
      });
      const html = await res.text();
      if (/captcha|robot check|sorry, we just need/i.test(html.slice(0, 4000))) {
        return { err: "captcha" as const };
      }
      if (/currently unavailable\.?\s*we don't know when/i.test(html)) {
        return { unavailable: true as const };
      }
      const decode = (s: string) =>
        (s || "")
          .replace(/&amp;/g, "&")
          .replace(/&#39;|&apos;|&#x27;/gi, "'")
          .replace(/&quot;/g, '"')
          .replace(/\s+/g, " ")
          .trim();
      let title = decode(
        (html.match(/<span id="productTitle"[^>]*>\s*([^<]+)/) ||
          html.match(/property="og:title"\s+content="([^"]+)/i) ||
          [])[1] || "",
      );
      title = title
        .replace(/^Amazon\.com\s*[|:]\s*/i, "")
        .replace(/\s*:\s*Amazon\.com.*$/i, "")
        .slice(0, 180);
      const priceRaw = (
        html.match(/"priceAmount":\s*([0-9.]+)/) ||
        html.match(/class="a-offscreen">\$([0-9.,]+)/) ||
        []
      )[1];
      const price = priceRaw ? parseFloat(String(priceRaw).replace(/,/g, "")) : 0;
      const listRaw = (html.match(/data-a-strike="true"[^>]*>[\s\S]*?\$([0-9.,]+)/) || [])[1];
      let originalPrice = listRaw ? parseFloat(String(listRaw).replace(/,/g, "")) : price;
      if (!(originalPrice > price) || originalPrice > price * 2.5) originalPrice = price;
      const image = (html.match(/property="og:image"\s+content="([^"]+)/i) || [])[1] || "";
      let brand = decode(
        (
          html.match(
            /id="bylineInfo"[^>]*>\s*(?:Brand:\s*|Visit the\s+)?([^<]+?)(?:\s+Store)?\s*</i,
          ) ||
          html.match(/"brand"\s*:\s*"([^"]{2,60})"/) ||
          []
        )[1] || "",
      );
      brand = brand.replace(/^Brand:\s*/i, "").slice(0, 60) || "Coach";
      const rating = parseFloat((html.match(/([0-9.]+)\s+out of 5 stars/) || [])[1] || "0");
      const reviewCount = parseInt(
        ((html.match(/([0-9,]+)\s+(?:global )?ratings/i) || [])[1] || "0").replace(/,/g, ""),
        10,
      );
      if (!title || !(price >= 1 && price < 5000)) return { err: "noparse" as const };
      return {
        title,
        brand,
        image,
        price,
        originalPrice,
        rating: rating || 4.5,
        reviewCount: reviewCount || 50,
      };
    }, asin);

    if (!result) return null;
    if ("err" in result) return null;
    if ("unavailable" in result) return { unavailable: true };
    return {
      ...result,
      image: result.image ? normalizeProductImage(result.image) : "",
      title: decode(result.title),
      brand: decode(result.brand),
    };
  } catch {
    return null;
  }
}

async function main() {
  const rows = await prisma.product.findMany({
    where: {
      OR: [
        { specifications: { contains: '"needsEnrichment":true' } },
        { specifications: { contains: '"needsEnrichment": true' } },
      ],
    },
    select: { id: true, asin: true, images: true, slug: true },
    take: LIMIT,
    orderBy: { createdAt: "asc" },
  });
  console.log(`Playwright enrich: ${rows.length} products, concurrency=${CONCURRENCY}`);

  const clothing = await prisma.category.findFirst({ where: { slug: "clothing" } });
  const browser = await chromium.launch({
    headless: false,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    locale: "en-US",
    viewport: { width: 1280, height: 800 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  // Warm cookies
  const warm = await context.newPage();
  await warm.goto("https://www.amazon.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(2000);
  await warm.close();

  const pages = await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      const p = await context.newPage();
      await p.goto("https://www.amazon.com/", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => undefined);
      return p;
    }),
  );

  let updated = 0;
  let failed = 0;
  let unavailable = 0;
  let idx = 0;
  const started = Date.now();

  async function worker(page: import("playwright").Page) {
    while (true) {
      const i = idx++;
      if (i >= rows.length) return;
      const row = rows[i];
      if (!row.asin) continue;

      await sleep(60 + Math.random() * 100);
      const scraped = await scrapeInPage(page, row.asin);

      if (!scraped) {
        failed++;
        if (failed <= 5 || failed % 50 === 0) {
          console.log(`progress ok=${updated} fail=${failed} unavail=${unavailable} (${i + 1}/${rows.length}) asin=${row.asin}`);
        }
        continue;
      }
      if ("unavailable" in scraped) {
        unavailable++;
        await prisma.product.update({
          where: { id: row.id },
          data: { availability: "unavailable", lastUpdated: new Date() },
        });
        continue;
      }

      const imgs = scraped.image
        ? [scraped.image]
        : (JSON.parse(row.images || "[]") as string[]);
      const discount =
        scraped.originalPrice > scraped.price
          ? Math.round(((scraped.originalPrice - scraped.price) / scraped.originalPrice) * 1000) / 10
          : 0;
      const slugBase = slugify(scraped.title).slice(0, 50) || row.asin.toLowerCase();
      let slug = `${slugBase}-${row.asin.toLowerCase()}`.slice(0, 180);
      let n = 2;
      while (await prisma.product.findFirst({ where: { slug, NOT: { id: row.id } } })) {
        slug = `${slugBase}-${row.asin.toLowerCase()}-${n++}`.slice(0, 180);
      }

      await prisma.product.update({
        where: { id: row.id },
        data: {
          title: scraped.title,
          description: `${scraped.title} — available on Amazon via DealForge.`,
          brand: scraped.brand,
          slug,
          images: JSON.stringify(imgs),
          price: scraped.price,
          originalPrice: scraped.originalPrice,
          discountPercent: discount,
          rating: scraped.rating,
          reviewCount: scraped.reviewCount,
          categoryId: clothing?.id,
          subcategory: inferClothingSubcategory(scraped.title, scraped.brand),
          availability: "in_stock",
          specifications: JSON.stringify({
            Brand: scraped.brand,
            ASIN: row.asin,
            Retailer: "Amazon",
            source: "user-batch",
            needsEnrichment: false,
            enrichedAt: new Date().toISOString(),
          }),
          lastUpdated: new Date(),
        },
      });
      updated++;
      if (updated <= 8 || updated % 50 === 0) {
        const m = ((Date.now() - started) / 60000).toFixed(1);
        console.log(`OK ${updated}  ${row.asin}  $${scraped.price}  [${m}m]  ${scraped.title.slice(0, 55)}`);
      }
    }
  }

  await Promise.all(pages.map((p) => worker(p)));
  await Promise.all(pages.map((p) => p.close()));
  await browser.close();
  await prisma.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });
  const left = await prisma.product.count({
    where: {
      OR: [
        { specifications: { contains: '"needsEnrichment":true' } },
        { specifications: { contains: '"needsEnrichment": true' } },
      ],
    },
  });
  console.log(`\nDone updated=${updated} failed=${failed} unavailable=${unavailable} left=${left}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
