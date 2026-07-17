/**
 * Enrich CDN-batched products with live Amazon title/price/image.
 * Safe to re-run — only touches needsEnrichment rows (or --force-price).
 *
 * Usage:
 *   npx tsx scripts/enrich-batch.ts
 *   npx tsx scripts/enrich-batch.ts --limit 500 --concurrency 4
 */
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
  return i >= 0 ? Math.max(1, Number(process.argv[i + 1]) || 3) : 4;
})();

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const UAS = [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
];

function decode(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function parseMoney(raw?: string | null): number {
  if (!raw) return 0;
  const n = parseFloat(raw.replace(/,/g, "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n >= 1 && n < 5000 ? n : 0;
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

async function scrape(asin: string): Promise<Scraped | { unavailable: true } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(1500 + attempt * 1000);
    const result = await scrapeOnce(asin);
    if (result) return result;
  }
  return null;
}

async function scrapeOnce(asin: string): Promise<Scraped | { unavailable: true } | null> {
  const ua = UAS[Math.floor(Math.random() * UAS.length)];
  const urls = [
    `https://smile.amazon.com/dp/${asin}`,
    `https://www.amazon.com/gp/aw/d/${asin}`,
    `https://www.amazon.com/dp/${asin}?th=1&psc=1`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": ua,
          "Accept-Language": "en-US,en;q=0.9",
          Accept: "text/html,application/xhtml+xml",
          "Cache-Control": "no-cache",
        },
        redirect: "follow",
      });
      if (!res.ok) continue;
      const html = await res.text();
      const head = html.slice(0, 5000);
      if (/captcha|robot check|sorry, we just need/i.test(head)) return null;
      if (/currently unavailable\.?\s*we don't know when/i.test(html)) {
        return { unavailable: true };
      }

      const title = decode(
        html.match(/<span id="productTitle"[^>]*>\s*([^<]+)/)?.[1] ||
          html.match(/property="og:title"\s+content="([^"]+)/i)?.[1] ||
          html.match(/<title>\s*([^<]+)/i)?.[1] ||
          "",
      )
        .replace(/^Amazon\.com\s*[|:]\s*/i, "")
        .replace(/\s*:\s*Amazon\.com.*$/i, "")
        .replace(/\s+Amazon\.com\s*$/i, "")
        .replace(/\s*\|\s*Amazon\.com.*$/i, "")
        .slice(0, 180);

      if (!title || title.length < 6 || /page not found|dog of amazon/i.test(title)) {
        continue;
      }

      const rawImg =
        html.match(/property="og:image"\s+content="([^"]+)/i)?.[1] ||
        html
          .match(/"hiRes":"(https:\/\/m\.media-amazon\.com\/images\/[IP]\/[^"]+)"/)?.[1]
          ?.replace(/\\u002F/g, "/") ||
        html.match(/(https:\/\/m\.media-amazon\.com\/images\/[IP]\/[A-Za-z0-9+\-_%,.]{10,})/)?.[1];
      const image = rawImg ? normalizeProductImage(rawImg) : "";

      const price =
        parseMoney(html.match(/"priceAmount":\s*([0-9.]+)/)?.[1]) ||
        parseMoney(html.match(/class="a-offscreen">\$([0-9.,]+)/)?.[1]) ||
        parseMoney(html.match(/id="priceblock_ourprice"[^>]*>\s*\$([0-9.,]+)/i)?.[1]) ||
        parseMoney(html.match(/id="priceblock_dealprice"[^>]*>\s*\$([0-9.,]+)/i)?.[1]) ||
        parseMoney(html.match(/data-a-color="price"[^>]*>[\s\S]*?\$([0-9.,]+)/)?.[1]);

      const list =
        parseMoney(html.match(/"listPrice"\s*:\s*"?\$?([0-9.,]+)/)?.[1]) ||
        parseMoney(html.match(/data-a-strike="true"[^>]*>[\s\S]*?\$([0-9.,]+)/)?.[1]) ||
        parseMoney(html.match(/class="a-price a-text-price"[^>]*>[\s\S]*?class="a-offscreen">\$([0-9.,]+)/)?.[1]);

      let originalPrice = list > price ? list : price;
      if (originalPrice > price * 2.5) originalPrice = price;

      const brand =
        decode(html.match(/id="bylineInfo"[^>]*>\s*(?:Visit the\s+)?([^<]+?)(?:\s+Store)?\s*</i)?.[1] || "") ||
        decode(html.match(/"brand"\s*:\s*"([^"]{2,60})"/)?.[1] || "") ||
        title.split(/\s+/)[0] ||
        "Amazon";

      const rating = parseFloat(html.match(/([0-9.]+)\s+out of 5 stars/)?.[1] || "0");
      const reviewCount = parseInt(
        (html.match(/([0-9,]+)\s+(?:global )?ratings/i)?.[1] || "0").replace(/,/g, ""),
        10,
      );

      // Require a real price — don't invent $29.99
      if (!price) continue;

      return {
        title,
        brand: brand.replace(/^Brand:\s*/i, "").slice(0, 60),
        image: image && /media-amazon\.com\/images\/[IP]\//i.test(image) ? image : "",
        price,
        originalPrice: originalPrice || price,
        rating: Number.isFinite(rating) && rating > 0 ? rating : 4.5,
        reviewCount: Number.isFinite(reviewCount) && reviewCount > 0 ? reviewCount : 50,
      };
    } catch {
      /* try next url */
    }
  }
  return null;
}

async function main() {
  const rows = await prisma.product.findMany({
    where: {
      OR: [
        { specifications: { contains: '"needsEnrichment":true' } },
        { specifications: { contains: '"needsEnrichment": true' } },
      ],
    },
    select: { id: true, asin: true, images: true, slug: true, title: true },
    take: LIMIT,
    orderBy: { createdAt: "asc" },
  });
  console.log(`Enriching ${rows.length} products (concurrency=${CONCURRENCY})…`);

  const clothing = await prisma.category.findFirst({ where: { slug: "clothing" } });
  let updated = 0;
  let failed = 0;
  let unavailable = 0;
  let noPrice = 0;
  let idx = 0;
  const started = Date.now();

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= rows.length) return;
      const row = rows[i];
      if (!row.asin) continue;

      await sleep(1800 + Math.random() * 1400);
      const scraped = await scrape(row.asin);

      if (!scraped) {
        failed++;
        if (failed % 25 === 0) {
          console.log(
            `progress updated=${updated} failed=${failed} unavailable=${unavailable} noPrice=${noPrice} (${i + 1}/${rows.length})`,
          );
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
      if (!scraped.price) {
        noPrice++;
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
      if (slug !== row.slug) {
        let n = 2;
        while (await prisma.product.findFirst({ where: { slug, NOT: { id: row.id } } })) {
          slug = `${slugBase}-${row.asin.toLowerCase()}-${n++}`.slice(0, 180);
        }
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
      if (updated <= 10 || updated % 50 === 0) {
        const elapsed = ((Date.now() - started) / 60000).toFixed(1);
        console.log(
          `OK ${updated}  ${row.asin}  $${scraped.price}  [${elapsed}m]  ${scraped.title.slice(0, 55)}`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  await prisma.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });

  const left = await prisma.product.count({
    where: {
      OR: [
        { specifications: { contains: '"needsEnrichment":true' } },
        { specifications: { contains: '"needsEnrichment": true' } },
      ],
    },
  });
  const still2999 = await prisma.product.count({
    where: {
      AND: [
        { price: 29.99 },
        {
          OR: [
            { specifications: { contains: '"needsEnrichment":true' } },
            { specifications: { contains: '"needsEnrichment": true' } },
          ],
        },
      ],
    },
  });

  console.log(
    `\nDone: updated=${updated} failed=${failed} unavailable=${unavailable} noPrice=${noPrice}`,
  );
  console.log(`Still need enrichment: ${left} (of which still $29.99: ${still2999})`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
