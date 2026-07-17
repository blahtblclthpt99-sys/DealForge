/**
 * Move obvious non-apparel items that landed in clothing back to better categories,
 * and tighten future classification.
 */
import { PrismaClient } from "@prisma/client";
import { inferClothingSubcategory } from "../src/lib/clothing-subcategory";

const prisma = new PrismaClient();

function betterCategory(title: string): string | null {
  if (/\b(book|board book|kindle|novel|paperback|hardcover|beginner books)\b/i.test(title)) {
    return "books";
  }
  if (/\b(garden flag|license.?plate|vanity plate|flag -|pirate .*flag)\b/i.test(title)) {
    return "home-kitchen";
  }
  if (/\b(yo-kai|medal \[loose\]|action figure|toy)\b/i.test(title) && !/\b(shirt|hoodie|dress)\b/i.test(title)) {
    return "toys";
  }
  if (/\b(apple watch band|watch band|silicone band compatible)\b/i.test(title)) {
    return "electronics";
  }
  if (/\b(ornament|tree decoration)\b/i.test(title) && !/\b(pajama|onesie|shirt)\b/i.test(title)) {
    return "home-kitchen";
  }
  if (/\b(doll clothes|reborn doll|doll outfit)\b/i.test(title)) {
    return "toys";
  }
  // "socks" alone in book titles already handled; coat of arms ≠ coat
  if (/\bcoat of arms\b/i.test(title)) return "home-kitchen";
  return null;
}

async function main() {
  const cats = await prisma.category.findMany();
  const bySlug = Object.fromEntries(cats.map((c) => [c.slug, c]));
  const clothing = bySlug.clothing;
  if (!clothing) throw new Error("no clothing");

  const rows = await prisma.product.findMany({
    where: { categoryId: clothing.id },
    select: { id: true, title: true, brand: true, specifications: true },
  });

  let moved = 0;
  for (const row of rows) {
    const next = betterCategory(row.title);
    if (!next || !bySlug[next]) continue;
    await prisma.product.update({
      where: { id: row.id },
      data: {
        categoryId: bySlug[next].id,
        subcategory: null,
      },
    });
    moved += 1;
    console.log("moved", next, row.title.slice(0, 70));
  }

  // Reclassify remaining clothing
  const remaining = await prisma.product.findMany({
    where: { categoryId: clothing.id },
    select: { id: true, title: true, brand: true, subcategory: true, specifications: true },
  });
  let classified = 0;
  for (const row of remaining) {
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
    classified += 1;
  }

  const total = await prisma.product.count({ where: { categoryId: clothing.id } });
  console.log({ moved, classified, total });
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
