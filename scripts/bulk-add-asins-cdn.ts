/**
 * Fast bulk-add ASINs using Amazon CDN images (no page scrape required).
 * Skips ASINs already in the DB. Marks rows for later title/price enrichment.
 *
 * Usage: npx tsx scripts/bulk-add-asins-cdn.ts
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { slugify } from "../src/lib/utils";
import { amazonDpLink } from "../src/lib/affiliate/providers/amazon";
import { AMAZON_ASSOCIATE_TAG } from "../src/lib/affiliate/amazon-config";

const FILE = "prisma/user-asins-batch.txt";
const HEAD_CONCURRENCY = 40;
const INSERT_BATCH = 80;

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cdnUrl(asin: string) {
  return `https://m.media-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_SX500_.jpg`;
}

async function imageOk(asin: string) {
  const url = cdnUrl(asin);
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") || 0);
    const type = res.headers.get("content-type") || "";
    if (!type.includes("image") || len < 2000) return null;
    return url;
  } catch {
    return null;
  }
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return out;
}

async function main() {
  const asins = [
    ...new Set(
      readFileSync(FILE, "utf8")
        .split(/\s+/)
        .map((a) => a.trim().toUpperCase())
        .filter((a) => /^[A-Z0-9]{10}$/.test(a)),
    ),
  ];
  console.log(`Loaded ${asins.length} unique ASINs`);

  const existing = new Set(
    (
      await prisma.product.findMany({
        where: { asin: { not: null } },
        select: { asin: true },
      })
    ).map((p) => p.asin!.toUpperCase()),
  );
  const todo = asins.filter((a) => !existing.has(a));
  console.log(`Skip existing: ${asins.length - todo.length} | To check: ${todo.length}`);

  const clothing = await prisma.category.findFirst({ where: { slug: "clothing" } });
  const electronics = await prisma.category.findFirst({ where: { slug: "electronics" } });
  if (!clothing && !electronics) throw new Error("No categories");
  const categoryId = (clothing || electronics)!.id;

  console.log("Verifying CDN images…");
  const images = await mapPool(todo, HEAD_CONCURRENCY, async (asin) => {
    const img = await imageOk(asin);
    return { asin, img };
  });

  const ready = images.filter((x) => x.img) as Array<{ asin: string; img: string }>;
  const noImg = images.length - ready.length;
  console.log(`CDN ok: ${ready.length} | no image: ${noImg}`);

  let added = 0;
  for (let i = 0; i < ready.length; i += INSERT_BATCH) {
    const chunk = ready.slice(i, i + INSERT_BATCH);
    const rows = [];
    for (const { asin, img } of chunk) {
      // Final race-safe skip
      if (existing.has(asin)) continue;
      const title = `Amazon listing ${asin}`;
      const slug = `amazon-${asin.toLowerCase()}`;
      rows.push({
        asin,
        slug,
        title,
        description: `${title} — Amazon Associates link via DealForge (${AMAZON_ASSOCIATE_TAG}).`,
        brand: "Amazon",
        categoryId,
        subcategory: clothing ? "accessories" : null,
        images: JSON.stringify([img]),
        price: 29.99,
        originalPrice: 29.99,
        discountPercent: 0,
        rating: 4.5,
        reviewCount: 50,
        affiliateUrl: amazonDpLink(asin),
        retailer: "amazon",
        availability: "in_stock",
        specifications: JSON.stringify({
          ASIN: asin,
          Retailer: "Amazon",
          source: "user-batch-cdn",
          needsEnrichment: true,
        }),
        trendingScore: 70,
        isFeatured: false,
        isFlashDeal: false,
      });
      existing.add(asin);
    }

    if (!rows.length) continue;
    try {
      const result = await prisma.product.createMany({ data: rows, skipDuplicates: true });
      added += result.count;
      console.log(`INSERT ${added}/${ready.length}`);
    } catch (e) {
      // Fallback one-by-one if batch hits slug conflicts
      for (const row of rows) {
        try {
          await prisma.product.create({
            data: {
              ...row,
              slug: `${row.slug}-${slugify(String(Date.now())).slice(-4)}`,
            },
          });
          added++;
        } catch {
          /* skip doubles */
        }
      }
      console.log(`INSERT(fallback) ${added}/${ready.length}`);
    }
    await sleep(50);
  }

  await prisma.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });
  const total = await prisma.product.count();
  const placeholders = await prisma.product.count({ where: { images: { contains: "placeholder" } } });
  console.log(
    `\nDone: added=${added} skippedExisting=${asins.length - todo.length} noImage=${noImg} products=${total} placeholders=${placeholders}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
