import { PrismaClient } from "@prisma/client";
import { slugify } from "../src/lib/utils";

const FIXES: Record<string, { title: string; brand: string; category?: string }> = {
  B0FD8D9NJF: {
    title: "Marc Joseph New York Mens Charles Ave Sneakers (Hands-Free Technology)",
    brand: "Marc Joseph New York",
    category: "clothing",
  },
  B0CRH74TD6: {
    title: "LASTING PINNIP Mens Steel-Toe Durable PU Rubber Work Boots",
    brand: "LASTING PINNIP",
    category: "clothing",
  },
  B01BA54YGO: {
    title: "Maui Jim Men's & Women's Castles Polarized Teardrop Sunglasses",
    brand: "Maui Jim",
    category: "clothing",
  },
};

async function main() {
  const prisma = new PrismaClient();
  const cats = await prisma.category.findMany();
  const bySlug = Object.fromEntries(cats.map((c) => [c.slug, c]));

  for (const [asin, fix] of Object.entries(FIXES)) {
    const cat = fix.category ? bySlug[fix.category] : null;
    await prisma.product.updateMany({
      where: { asin },
      data: {
        title: fix.title,
        brand: fix.brand,
        slug: `${slugify(fix.title)}-${asin.toLowerCase()}`.slice(0, 180),
        description: `${fix.title} — available on Amazon. DealForge links with Associates tag titanfieldos-20.`,
        ...(cat ? { categoryId: cat.id } : {}),
      },
    });
    console.log(`fixed ${asin}`);
  }

  const rows = await prisma.product.findMany({
    where: { asin: { in: Object.keys(FIXES).concat(["B0DZM1WVCS", "B0DYLG399L"]) } },
    select: { asin: true, title: true, price: true, affiliateUrl: true, brand: true },
  });
  console.log(JSON.stringify(rows, null, 2));
  await prisma.$disconnect();
}

main();
