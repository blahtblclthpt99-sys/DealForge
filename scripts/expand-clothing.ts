import { writeFileSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { slugify } from "../src/lib/utils";
import { amazonDpLink } from "../src/lib/affiliate/providers/amazon";
import {
  CLOTHING_EXPANSION,
  clothingImageUrl,
} from "../src/lib/clothing-catalog";
import { inferClothingSubcategory } from "../src/lib/clothing-subcategory";

const prisma = new PrismaClient();

const APPAREL_RE =
  /\b(shirt|shirts|pants|jeans|dress|dresses|hoodie|sneaker|sneakers|jacket|coat|sweater|bra\b|legging|leggings|sock|socks|sandal|sandals|boot|boots|beanie|polo|shorts|blouse|skirt|romper|onesie|bodysuit|footwear|camisole|cardigan|sweatshirt|parka|windbreaker|pajama|pyjama|overalls?)\b/i;

async function classifyClothing() {
  const clothing = await prisma.category.findUnique({ where: { slug: "clothing" } });
  if (!clothing) throw new Error("clothing category missing");

  const rows = await prisma.product.findMany({
    where: { categoryId: clothing.id },
    select: { id: true, title: true, brand: true, subcategory: true, specifications: true },
  });

  let updated = 0;
  for (const row of rows) {
    const sub = inferClothingSubcategory(row.title, row.brand);
    if (row.subcategory === sub) continue;
    let specs: Record<string, string> = {};
    try {
      specs = JSON.parse(row.specifications || "{}") as Record<string, string>;
    } catch {
      specs = {};
    }
    specs.Department = sub;
    await prisma.product.update({
      where: { id: row.id },
      data: { subcategory: sub, specifications: JSON.stringify(specs) },
    });
    updated += 1;
  }
  return { total: rows.length, updated };
}

async function moveApparelIntoClothing() {
  const clothing = await prisma.category.findUnique({ where: { slug: "clothing" } });
  if (!clothing) throw new Error("clothing category missing");

  const candidates = await prisma.product.findMany({
    where: {
      category: { slug: { notIn: ["clothing", "pet-supplies", "books", "toys", "grocery"] } },
    },
    select: {
      id: true,
      title: true,
      brand: true,
      category: { select: { slug: true } },
      specifications: true,
    },
  });

  let moved = 0;
  for (const row of candidates) {
    if (!APPAREL_RE.test(row.title)) continue;
    // Exclude false positives (books with "socks", coat of arms, watch bands, etc.)
    if (
      /\b(book|board book|kindle|novel|paperback|hardcover|beginner books|garden flag|license.?plate|coat of arms|apple watch band|watch band|ornament|yo-kai|medal \[loose\]|doll clothes|reborn doll)\b/i.test(
        row.title,
      )
    ) {
      continue;
    }
    if (
      /\b(drill|wrench|socket|battery|charger|hdmi|usb|laptop|tablet|phone case|screen protector)\b/i.test(
        row.title,
      )
    ) {
      continue;
    }
    const sub = inferClothingSubcategory(row.title, row.brand);
    let specs: Record<string, string> = {};
    try {
      specs = JSON.parse(row.specifications || "{}") as Record<string, string>;
    } catch {
      specs = {};
    }
    specs.Department = sub;
    await prisma.product.update({
      where: { id: row.id },
      data: {
        categoryId: clothing.id,
        subcategory: sub,
        specifications: JSON.stringify(specs),
      },
    });
    moved += 1;
  }
  return moved;
}

async function importExpansionCatalog() {
  const clothing = await prisma.category.findUnique({ where: { slug: "clothing" } });
  if (!clothing) throw new Error("clothing category missing");

  const existing = new Set(
    (await prisma.product.findMany({ select: { asin: true } }))
      .map((p) => p.asin)
      .filter(Boolean) as string[],
  );

  let added = 0;
  const catalogRows: Array<Record<string, unknown>> = [];

  for (const item of CLOTHING_EXPANSION) {
    catalogRows.push({
      asin: item.asin,
      category: "clothing",
      title: item.title,
      brand: item.brand,
      image: clothingImageUrl(item.asin),
      images: [clothingImageUrl(item.asin)],
      price: item.price,
      originalPrice: item.originalPrice,
      rating: item.rating,
      reviewCount: item.reviewCount,
      featured: false,
      flash: item.originalPrice > item.price * 1.15,
    });

    if (existing.has(item.asin)) continue;
    // Skip P/-only images — require a real CDN URL from add-asins scrape instead
    if (!item.asin || item.asin.length !== 10) continue;

    const discountPercent =
      item.originalPrice > item.price
        ? Math.round(((item.originalPrice - item.price) / item.originalPrice) * 1000) / 10
        : 0;

    const slug = `${slugify(item.title)}-${item.asin.toLowerCase()}`.slice(0, 180);
    try {
      await prisma.product.create({
        data: {
          asin: item.asin,
          slug,
          title: item.title,
          description: `${item.title} — available on Amazon via DealForge.`,
          brand: item.brand,
          categoryId: clothing.id,
          subcategory: item.subcategory,
          images: JSON.stringify([clothingImageUrl(item.asin)]),
          price: item.price,
          originalPrice: item.originalPrice,
          discountPercent,
          rating: item.rating,
          reviewCount: item.reviewCount,
          affiliateUrl: amazonDpLink(item.asin),
          retailer: "amazon",
          availability: "in_stock",
          specifications: JSON.stringify({
            Brand: item.brand,
            ASIN: item.asin,
            Retailer: "Amazon",
            Department: item.subcategory,
          }),
          trendingScore: 70 + Math.random() * 20,
          clickCount: Math.floor(Math.random() * 100),
          viewCount: Math.floor(Math.random() * 800) + 50,
          isFeatured: false,
          isFlashDeal: item.originalPrice > item.price * 1.15,
          flashEndsAt:
            item.originalPrice > item.price * 1.15
              ? new Date(Date.now() + 1000 * 60 * 60 * 36)
              : null,
          lastUpdated: new Date(),
        },
      });
      existing.add(item.asin);
      added += 1;
    } catch (e) {
      console.warn("skip", item.asin, (e as Error).message?.slice(0, 80));
    }
  }

  writeFileSync(
    path.join(process.cwd(), "prisma", "clothing-catalog.json"),
    JSON.stringify(catalogRows, null, 2),
  );

  return added;
}

async function main() {
  console.log("Classifying clothing…");
  const classified = await classifyClothing();
  console.log(`classified ${classified.updated}/${classified.total}`);

  console.log("Moving apparel-like items into clothing…");
  const moved = await moveApparelIntoClothing();
  console.log(`moved ${moved}`);

  console.log("Importing clothing expansion catalog…");
  const added = await importExpansionCatalog();
  console.log(`added ${added} new products`);

  // Reclassify after moves
  const again = await classifyClothing();
  console.log(`reclassified ${again.updated}/${again.total}`);

  const clothing = await prisma.category.findUnique({ where: { slug: "clothing" } });
  const counts = await prisma.product.groupBy({
    by: ["subcategory"],
    where: { categoryId: clothing!.id },
    _count: { _all: true },
  });
  console.log("\nClothing department counts:");
  for (const c of counts.sort((a, b) => (a.subcategory || "").localeCompare(b.subcategory || ""))) {
    console.log(`  ${c.subcategory ?? "(none)"}: ${c._count._all}`);
  }

  await prisma.cacheEntry.deleteMany({
    where: {
      OR: [{ key: { startsWith: "products:" } }, { key: { startsWith: "categories:" } }],
    },
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
