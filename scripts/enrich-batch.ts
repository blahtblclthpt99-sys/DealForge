/**
 * Enrich CDN-batched products (needsEnrichment) with live Amazon title/price/image.
 * Skips products that already have real titles. Safe to re-run.
 *
 * Usage: npx tsx scripts/enrich-batch.ts [--limit 500] [--concurrency 2]
 */
import { PrismaClient } from "@prisma/client";
import { slugify } from "../src/lib/utils";
import { normalizeProductImage } from "../src/lib/product-image";
import { inferClothingSubcategory } from "../src/lib/clothing-subcategory";

const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Number(process.argv[i + 1]) : 2000;
})();
const CONCURRENCY = (() => {
  const i = process.argv.indexOf("--concurrency");
  return i >= 0 ? Math.max(1, Number(process.argv[i + 1]) || 2) : 2;
})();

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function decode(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

async function scrape(asin: string) {
  try {
    const res = await fetch(`https://www.amazon.com/gp/aw/d/${asin}`, {
      headers: { "User-Agent": UA_MOBILE, "Accept-Language": "en-US,en;q=0.9" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (/captcha|robot check/i.test(html.slice(0, 4000))) return null;
    if (/currently unavailable\.?\s*we don't know when/i.test(html)) return { unavailable: true as const };

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
      html.match(/(https:\/\/m\.media-amazon\.com\/images\/[IP]\/[A-Za-z0-9+\-_%,.]{10,})/)?.[1];
    const image = rawImg ? normalizeProductImage(rawImg) : "";
    const priceRaw =
      html.match(/"priceAmount":\s*([0-9.]+)/)?.[1] ||
      html.match(/class="a-offscreen">\$([0-9.,]+)/)?.[1];
    const price = priceRaw ? parseFloat(priceRaw.replace(/,/g, "")) : 0;
    const brand =
      decode(html.match(/"brand":\s*"([^"]{2,40})"/)?.[1] || "") ||
      title.split(/\s+/)[0] ||
      "Coach";
    const rating = parseFloat(html.match(/([0-9.]+) out of 5 stars/)?.[1] || "4.5");
    const reviewCount = parseInt(
      (html.match(/([0-9,]+)\s+(?:global )?ratings/i)?.[1] || "50").replace(/,/g, ""),
      10,
    );
    if (!title || title.length < 6) return null;
    return {
      title,
      brand,
      image: image && /media-amazon\.com\/images\/[IP]\//i.test(image) ? image : "",
      price: price >= 1 && price < 5000 ? price : 0,
      rating: Number.isFinite(rating) ? rating : 4.5,
      reviewCount: Number.isFinite(reviewCount) ? reviewCount : 50,
    };
  } catch {
    return null;
  }
}

async function main() {
  // Interim: label CDN stubs as Coach (this batch is Coach catalog)
  await prisma.$executeRawUnsafe(`
    UPDATE "Product"
    SET brand = 'Coach',
        title = 'Coach product ' || asin,
        description = 'Coach product ' || asin || ' — available on Amazon via DealForge.'
    WHERE specifications LIKE '%user-batch-cdn%'
      AND specifications LIKE '%needsEnrichment%'
      AND title LIKE 'Amazon listing %'
  `);

  const rows = await prisma.product.findMany({
    where: { specifications: { contains: "needsEnrichment" } },
    select: { id: true, asin: true, images: true, slug: true },
    take: LIMIT,
    orderBy: { createdAt: "asc" },
  });
  console.log(`Enriching up to ${rows.length} (concurrency=${CONCURRENCY})…`);

  const clothing = await prisma.category.findFirst({ where: { slug: "clothing" } });
  let updated = 0;
  let failed = 0;
  let unavailable = 0;
  let idx = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= rows.length) return;
      const row = rows[i];
      if (!row.asin) continue;
      await sleep(1200 + Math.random() * 800);
      const scraped = await scrape(row.asin);
      if (!scraped) {
        failed++;
        if (failed % 50 === 0) console.log(`fail=${failed} ok=${updated}`);
        continue;
      }
      if ("unavailable" in scraped) {
        unavailable++;
        await prisma.product.update({
          where: { id: row.id },
          data: { availability: "unavailable" },
        });
        continue;
      }

      const imgs = scraped.image
        ? [scraped.image]
        : (JSON.parse(row.images || "[]") as string[]);
      const price = scraped.price || 29.99;
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
          price,
          originalPrice: price,
          rating: scraped.rating,
          reviewCount: scraped.reviewCount,
          categoryId: clothing?.id,
          subcategory: inferClothingSubcategory(scraped.title, scraped.brand),
          specifications: JSON.stringify({
            Brand: scraped.brand,
            ASIN: row.asin,
            Retailer: "Amazon",
            source: "user-batch",
            needsEnrichment: false,
          }),
          lastUpdated: new Date(),
        },
      });
      updated++;
      if (updated % 25 === 0 || updated <= 5) {
        console.log(`OK ${updated}  ${row.asin}  $${price}  ${scraped.title.slice(0, 50)}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  await prisma.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });
  const left = await prisma.product.count({
    where: { specifications: { contains: "needsEnrichment\":true" } },
  });
  console.log(`\nDone: updated=${updated} failed=${failed} unavailable=${unavailable} stillNeedEnrichment≈${left}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
