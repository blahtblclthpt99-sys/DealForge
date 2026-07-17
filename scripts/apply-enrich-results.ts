/**
 * Apply browser-scraped enrich results to the DB.
 * Input: prisma/enrich-results.jsonl (one JSON object per line)
 *   { id, asin, title, brand, price, originalPrice?, image?, rating?, reviewCount? }
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { slugify } from "../src/lib/utils";
import { normalizeProductImage } from "../src/lib/product-image";
import { inferClothingSubcategory } from "../src/lib/clothing-subcategory";

const INPUT = process.argv[2] || "prisma/enrich-results.jsonl";
const prisma = new PrismaClient();

type Row = {
  id?: string;
  asin: string;
  title: string;
  brand?: string;
  price: number;
  originalPrice?: number;
  image?: string;
  rating?: number;
  reviewCount?: number;
  unavailable?: boolean;
};

async function main() {
  if (!existsSync(INPUT)) {
    console.log("No results file");
    return;
  }
  const lines = readFileSync(INPUT, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const clothing = await prisma.category.findFirst({ where: { slug: "clothing" } });

  // Map asin -> id from queue if needed
  const queue = existsSync("prisma/enrich-queue.json")
    ? (JSON.parse(readFileSync("prisma/enrich-queue.json", "utf8")) as Array<{ id: string; asin: string }>)
    : [];
  const idByAsin = new Map(queue.map((q) => [q.asin.toUpperCase(), q.id]));

  let updated = 0;
  let skipped = 0;

  for (const line of lines) {
    let row: Row;
    try {
      row = JSON.parse(line) as Row;
    } catch {
      skipped++;
      continue;
    }
    const asin = (row.asin || "").toUpperCase();
    const id = row.id || idByAsin.get(asin);
    if (!id || !asin) {
      skipped++;
      continue;
    }
    if (row.unavailable) {
      await prisma.product.update({
        where: { id },
        data: { availability: "unavailable", lastUpdated: new Date() },
      });
      updated++;
      continue;
    }
    if (!row.title || !(row.price >= 1 && row.price < 5000)) {
      skipped++;
      continue;
    }

    const title = row.title
      .replace(/^Amazon\.com\s*[|:]\s*/i, "")
      .replace(/&amp;/g, "&")
      .replace(/&#39;|&apos;|&#x27;/gi, "'")
      .replace(/&quot;/g, '"')
      .trim()
      .slice(0, 180);
    const brand = (row.brand || title.split(/\s+/)[0] || "Coach").slice(0, 60);
    const price = row.price;
    let original = row.originalPrice && row.originalPrice > price ? row.originalPrice : price;
    if (original > price * 2.5) original = price;
    const discount =
      original > price ? Math.round(((original - price) / original) * 1000) / 10 : 0;
    const image = row.image ? normalizeProductImage(row.image) : "";

    const slugBase = slugify(title).slice(0, 50) || asin.toLowerCase();
    let slug = `${slugBase}-${asin.toLowerCase()}`.slice(0, 180);
    let n = 2;
    while (await prisma.product.findFirst({ where: { slug, NOT: { id } } })) {
      slug = `${slugBase}-${asin.toLowerCase()}-${n++}`.slice(0, 180);
    }

    const existing = await prisma.product.findUnique({
      where: { id },
      select: { images: true },
    });
    const imgs = image
      ? [image]
      : (JSON.parse(existing?.images || "[]") as string[]);

    await prisma.product.update({
      where: { id },
      data: {
        title,
        description: `${title} — available on Amazon via DealForge.`,
        brand,
        slug,
        images: JSON.stringify(imgs),
        price,
        originalPrice: original,
        discountPercent: discount,
        rating: row.rating && row.rating > 0 ? row.rating : 4.5,
        reviewCount: row.reviewCount && row.reviewCount > 0 ? row.reviewCount : 50,
        categoryId: clothing?.id,
        subcategory: inferClothingSubcategory(title, brand),
        availability: "in_stock",
        specifications: JSON.stringify({
          Brand: brand,
          ASIN: asin,
          Retailer: "Amazon",
          source: "user-batch",
          needsEnrichment: false,
          enrichedAt: new Date().toISOString(),
        }),
        lastUpdated: new Date(),
      },
    });
    updated++;
  }

  await prisma.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });

  // Rewrite queue without done ASINs
  if (queue.length) {
    const done = new Set(
      lines
        .map((l) => {
          try {
            return (JSON.parse(l) as Row).asin?.toUpperCase();
          } catch {
            return null;
          }
        })
        .filter(Boolean) as string[],
    );
    const left = queue.filter((q) => !done.has(q.asin.toUpperCase()));
    writeFileSync("prisma/enrich-queue.json", JSON.stringify(left));
    console.log(`Updated=${updated} skipped=${skipped} queueLeft=${left.length}`);
  } else {
    console.log(`Updated=${updated} skipped=${skipped}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
