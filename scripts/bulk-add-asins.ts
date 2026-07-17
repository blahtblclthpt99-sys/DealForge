/**
 * Bulk-add ASINs from prisma/user-asins-batch.txt
 * - Dedupes the file list
 * - Skips ASINs already in the DB (no doubles)
 * - Concurrent mobile scrapes with CDN image fallback
 *
 * Usage: npx tsx scripts/bulk-add-asins.ts [--file prisma/user-asins-batch.txt] [--concurrency 3]
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { slugify } from "../src/lib/utils";
import { amazonDpLink } from "../src/lib/affiliate/providers/amazon";
import { AMAZON_ASSOCIATE_TAG } from "../src/lib/affiliate/amazon-config";
import { normalizeProductImage } from "../src/lib/product-image";
import { inferClothingSubcategory } from "../src/lib/clothing-subcategory";

const FILE =
  process.argv.includes("--file")
    ? process.argv[process.argv.indexOf("--file") + 1]
    : "prisma/user-asins-batch.txt";
const CONCURRENCY = (() => {
  const i = process.argv.indexOf("--concurrency");
  return i >= 0 ? Math.max(1, Number(process.argv[i + 1]) || 3) : 3;
})();

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function decode(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function categorize(title: string) {
  const t = title.toLowerCase();
  if (/dress|shirt|pant|jean|shoe|boot|sneaker|sock|bra|legging|hoodie|jacket|coat|sweater|tee|top for women|men's|womens|clothing|sandal|slipper|underwear|lingerie|short|skirt|blouse/i.test(t))
    return "clothing";
  if (/makeup|serum|lotion|shampoo|skincare|beauty|moisturizer|lipstick/i.test(t)) return "beauty";
  if (/toy|lego|doll|puzzle/i.test(t)) return "toys";
  if (/dog|cat|pet |puppy|kitten/i.test(t)) return "pet-supplies";
  if (/tool|drill|wrench|saw /i.test(t)) return "tools";
  if (/game|xbox|playstation|nintendo|controller/i.test(t)) return "gaming";
  if (/book|novel|paperback/i.test(t)) return "books";
  if (/kitchen|cook|pan |pot |blender|vacuum|pillow|sheet|towel|home/i.test(t)) return "home-kitchen";
  return "electronics";
}

function isUsableImage(url: string) {
  if (!url || url.includes("placeholder")) return false;
  return /media-amazon\.com\/images\/[IP]\//i.test(url);
}

async function scrape(asin: string) {
  for (const [url, headers] of [
    [`https://www.amazon.com/gp/aw/d/${asin}`, { "User-Agent": UA_MOBILE, "Accept-Language": "en-US,en;q=0.9" }],
    [`https://www.amazon.com/dp/${asin}`, { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }],
  ] as const) {
    try {
      const res = await fetch(url, { headers, redirect: "follow" });
      if (!res.ok) continue;
      const html = await res.text();
      if (/captcha|robot check/i.test(html.slice(0, 4000))) continue;
      if (/page not found|currently unavailable\.?\s*we don't know when/i.test(html)) return null;

      const title = decode(
        html.match(/<span id="productTitle"[^>]*>\s*([^<]+)/)?.[1] ||
          html.match(/property="og:title"\s+content="([^"]+)/i)?.[1] ||
          "",
      )
        .replace(/\s*:\s*Amazon\.com.*$/i, "")
        .replace(/^Amazon\.com\s*:\s*/i, "")
        .slice(0, 160);

      const rawImg =
        html.match(/property="og:image"\s+content="([^"]+)/i)?.[1] ||
        html.match(/"hiRes":"(https:\/\/m\.media-amazon\.com\/images\/[IP]\/[^"]+)"/)?.[1]?.replace(
          /\\u002F/g,
          "/",
        ) ||
        html.match(/(https:\/\/m\.media-amazon\.com\/images\/[IP]\/[A-Za-z0-9+\-_%,.]{10,})/)?.[1] ||
        `https://m.media-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_SX500_.jpg`;

      const image = normalizeProductImage(rawImg);
      const priceRaw =
        html.match(/"priceAmount":\s*([0-9.]+)/)?.[1] ||
        html.match(/class="a-offscreen">\$([0-9.,]+)/)?.[1];
      const price = priceRaw ? parseFloat(priceRaw.replace(/,/g, "")) : 0;
      const listRaw = html.match(/List Price[^$]{0,40}\$([0-9.,]+)/i)?.[1];
      let original = listRaw ? parseFloat(listRaw.replace(/,/g, "")) : price;
      if (!(original > price) || original > price * 2.5) original = price;
      const brand =
        decode(html.match(/"brand":\s*"([^"]{2,40})"/)?.[1] || "") ||
        title.split(/\s+/)[0] ||
        "Amazon";
      const rating = parseFloat(html.match(/([0-9.]+) out of 5 stars/)?.[1] || "4.5");
      const reviewCount = parseInt(
        (html.match(/([0-9,]+)\s+(?:global )?ratings/i)?.[1] || "100").replace(/,/g, ""),
        10,
      );

      if (!title || title.length < 6) continue;
      if (!isUsableImage(image)) continue;
      if (!(price >= 1 && price < 5000)) continue;

      return {
        asin,
        title,
        brand,
        image,
        price,
        originalPrice: original,
        rating: Number.isFinite(rating) ? rating : 4.5,
        reviewCount: Number.isFinite(reviewCount) ? reviewCount : 100,
      };
    } catch {
      continue;
    }
  }
  return null;
}

async function main() {
  const raw = readFileSync(FILE, "utf8");
  const asins = [...new Set(raw.split(/\s+/).map((a) => a.trim().toUpperCase()).filter((a) => /^[A-Z0-9]{10}$/.test(a)))];
  console.log(`Loaded ${asins.length} unique ASINs from ${FILE}`);

  const existing = new Set(
    (
      await prisma.product.findMany({
        where: { asin: { not: null } },
        select: { asin: true },
      })
    ).map((p) => p.asin!.toUpperCase()),
  );
  const todo = asins.filter((a) => !existing.has(a));
  console.log(`Already in DB: ${asins.length - todo.length}  |  To add: ${todo.length}  |  concurrency=${CONCURRENCY}`);

  const categories = await prisma.category.findMany();
  const bySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));

  let added = 0;
  let failed = 0;
  let idx = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= todo.length) return;
      const asin = todo[i];
      await sleep(400 + Math.random() * 600);
      const scraped = await scrape(asin);
      if (!scraped) {
        failed++;
        if (failed % 25 === 0 || failed <= 5) console.log(`FAIL ${asin}  (failed=${failed})`);
        continue;
      }

      // Race-safe double-check
      const dup = await prisma.product.findFirst({ where: { asin }, select: { id: true } });
      if (dup) {
        console.log(`SKIP ${asin} (already exists)`);
        continue;
      }

      const catSlug = categorize(scraped.title);
      const cat = bySlug[catSlug] || bySlug.electronics;
      const slugBase = slugify(scraped.title).slice(0, 50) || asin.toLowerCase();
      let slug = `${slugBase}-${asin.toLowerCase()}`.slice(0, 180);
      let n = 2;
      while (await prisma.product.findUnique({ where: { slug } })) {
        slug = `${slugBase}-${asin.toLowerCase()}-${n++}`.slice(0, 180);
      }
      const discount =
        scraped.originalPrice > scraped.price
          ? Math.round(((scraped.originalPrice - scraped.price) / scraped.originalPrice) * 1000) / 10
          : 0;

      try {
        await prisma.product.create({
          data: {
            asin,
            slug,
            title: scraped.title,
            description: `${scraped.title} — available on Amazon via DealForge.`,
            brand: scraped.brand,
            categoryId: cat.id,
            subcategory:
              cat.slug === "clothing" ? inferClothingSubcategory(scraped.title, scraped.brand) : null,
            images: JSON.stringify([scraped.image]),
            price: scraped.price,
            originalPrice: scraped.originalPrice,
            discountPercent: discount,
            rating: scraped.rating,
            reviewCount: scraped.reviewCount,
            affiliateUrl: amazonDpLink(asin, AMAZON_ASSOCIATE_TAG),
            retailer: "amazon",
            availability: "in_stock",
            specifications: JSON.stringify({
              Brand: scraped.brand,
              ASIN: asin,
              Retailer: "Amazon",
              source: "user-batch",
            }),
            trendingScore: 88,
            isFeatured: added < 30,
            isFlashDeal: discount >= 15,
          },
        });
        added++;
        if (added % 10 === 0 || added <= 5) {
          console.log(
            `OK  ${added}/${todo.length}  ${asin}  $${scraped.price}  ${scraped.title.slice(0, 50)}`,
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/Unique constraint|unique/i.test(msg)) {
          console.log(`SKIP ${asin} (unique conflict)`);
        } else {
          failed++;
          console.log(`ERR  ${asin}  ${msg.slice(0, 120)}`);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  await prisma.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });
  const total = await prisma.product.count();
  const placeholders = await prisma.product.count({ where: { images: { contains: "placeholder" } } });
  console.log(`\nDone: added=${added} failed=${failed} skippedExisting=${asins.length - todo.length} products=${total} placeholders=${placeholders}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
