/**
 * Restore missing product images on Neon without deleting products.
 * - Re-inserts ASINs removed when scrapes failed
 * - Sets Amazon /images/P/ CDN when that returns a real JPEG
 * - Leaves blank-GIF ASINs out of catalog JSON (unusable listings)
 */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { slugify } from "../src/lib/utils";
import { amazonDpLink } from "../src/lib/affiliate/providers/amazon";
import { AMAZON_ASSOCIATE_TAG } from "../src/lib/affiliate/amazon-config";
import { inferClothingSubcategory } from "../src/lib/clothing-subcategory";

const prisma = new PrismaClient();
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const REMOVED_ASINS = [
  "B086KSDTQ4",
  "B00D1ARZMC",
  "B07JCS8NRC",
  "B0FS1DBXTG",
  "B075ZZ7XKD",
  "B0FTSRNCNF",
  "B0DSVVJBRK",
  "B0FNC4GM8V",
  "B0BHXB24QW",
  "B07M989JLF",
  "B0DNMJ694B",
];

type CatalogProduct = {
  asin: string;
  category: string;
  title: string;
  brand: string;
  image: string;
  images?: string[];
  price: number;
  originalPrice: number;
  rating: number;
  reviewCount: number;
  featured?: boolean;
  flash?: boolean;
  trending?: number;
};

function pImage(asin: string) {
  return `https://m.media-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_SX500_.jpg`;
}

async function imageBytes(url: string) {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": UA, Range: "bytes=0-64" },
      redirect: "follow",
    });
    if (!res.ok) return 0;
    const buf = Buffer.from(await res.arrayBuffer());
    const lenHeader = Number(res.headers.get("content-length") || 0);
    const contentRange = res.headers.get("content-range");
    if (contentRange) {
      const total = Number(contentRange.split("/")[1] || 0);
      if (total > 0) return total;
    }
    // If server ignored Range, we only have a slice — fall back to HEAD/full GET size hint
    if (lenHeader > 0) return lenHeader;
    return buf.length;
  } catch {
    return 0;
  }
}

async function resolveCdn(asin: string) {
  const candidates = [
    pImage(asin),
    `https://m.media-amazon.com/images/P/${asin}.01.MAIN._SCLZZZZZZZ_SX500_.jpg`,
    `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_SX500_.jpg`,
  ];
  for (const url of candidates) {
    const bytes = await imageBytes(url);
    // Real product JPEGs are typically >2KB; blank Amazon GIFs are ~43 bytes
    if (bytes >= 2000) return url;
  }
  return null;
}

async function main() {
  const discPath = path.join(process.cwd(), "prisma", "amazon-discovered.json");
  const discovered = JSON.parse(readFileSync(discPath, "utf8")) as CatalogProduct[];
  const byAsin = new Map(discovered.map((p) => [String(p.asin).toUpperCase(), p]));

  const categories = await prisma.category.findMany();
  const bySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));

  let restored = 0;
  let skipped = 0;
  const unusable: string[] = [];

  for (const asin of REMOVED_ASINS) {
    const existing = await prisma.product.findFirst({ where: { asin } });
    if (existing) {
      const img = (JSON.parse(existing.images || "[]") as string[])[0] || "";
      if (img && !img.includes("placeholder")) {
        console.log("KEEP", asin);
        continue;
      }
    }

    const cdn = await resolveCdn(asin);
    const meta = byAsin.get(asin);
    if (!cdn) {
      console.log("NO_IMAGE", asin, meta?.title?.slice(0, 50));
      unusable.push(asin);
      skipped++;
      continue;
    }
    if (!meta) {
      console.log("NO_META", asin);
      skipped++;
      continue;
    }

    const cat = bySlug[meta.category] || bySlug.clothing;
    if (!cat) throw new Error("missing clothing category");

    const slugBase = slugify(meta.title).slice(0, 60) || asin.toLowerCase();
    let slug = slugBase;
    let n = 2;
    while (await prisma.product.findUnique({ where: { slug } })) {
      slug = `${slugBase}-${n++}`;
    }

    const images = JSON.stringify([cdn]);
    const discount =
      meta.originalPrice > meta.price
        ? Math.round(((meta.originalPrice - meta.price) / meta.originalPrice) * 100)
        : 0;

    if (existing) {
      await prisma.product.update({
        where: { id: existing.id },
        data: { images },
      });
    } else {
      await prisma.product.create({
        data: {
          asin,
          slug,
          title: meta.title,
          description: meta.title,
          brand: meta.brand || "Amazon",
          categoryId: cat.id,
          subcategory: inferClothingSubcategory(meta.title, meta.brand),
          images,
          price: meta.price,
          originalPrice: meta.originalPrice || meta.price,
          discountPercent: discount,
          rating: meta.rating || 4.5,
          reviewCount: meta.reviewCount || 100,
          affiliateUrl: amazonDpLink(asin, AMAZON_ASSOCIATE_TAG),
          retailer: "amazon",
          availability: "in_stock",
          specifications: JSON.stringify({}),
          trendingScore: meta.trending || 50,
          isFeatured: Boolean(meta.featured),
          isFlashDeal: Boolean(meta.flash),
        },
      });
    }

    // Patch catalog JSON so future seeds keep the CDN
    meta.image = cdn;
    meta.images = [cdn];
    restored++;
    console.log("RESTORED", asin, cdn);
  }

  // Also fix any remaining placeholders still in DB
  const placeholders = await prisma.product.findMany({
    where: { images: { contains: "placeholder" } },
    select: { id: true, asin: true, title: true },
  });
  for (const row of placeholders) {
    if (!row.asin) continue;
    const cdn = await resolveCdn(row.asin);
    if (!cdn) {
      console.log("PLACEHOLDER_NO_CDN", row.asin);
      continue;
    }
    await prisma.product.update({
      where: { id: row.id },
      data: { images: JSON.stringify([cdn]) },
    });
    const meta = byAsin.get(row.asin);
    if (meta) {
      meta.image = cdn;
      meta.images = [cdn];
    }
    restored++;
    console.log("FIXED_PLACEHOLDER", row.asin, cdn);
  }

  // Drop unusable ASINs from discovered catalog (blank Amazon images)
  if (unusable.length) {
    const next = discovered.filter((p) => !unusable.includes(String(p.asin).toUpperCase()));
    writeFileSync(discPath, JSON.stringify(next, null, 2));
    console.log("Removed unusable ASINs from amazon-discovered.json:", unusable);
  } else {
    writeFileSync(discPath, JSON.stringify(discovered, null, 2));
  }

  await prisma.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });

  const left = await prisma.product.count({
    where: {
      OR: [
        { images: { contains: "placeholder" } },
        { images: { equals: "[]" } },
        { images: { equals: "" } },
      ],
    },
  });

  console.log("\n=== Done ===");
  console.log({ restored, skipped, unusable: unusable.length, placeholdersLeft: left });
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
