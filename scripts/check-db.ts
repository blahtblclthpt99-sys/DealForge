import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const total = await prisma.product.count();
  const rows = await prisma.product.findMany({ select: { asin: true, slug: true, images: true } });

  const asinCounts = new Map<string, number>();
  for (const r of rows) if (r.asin) asinCounts.set(r.asin, (asinCounts.get(r.asin) || 0) + 1);
  const dupAsins = [...asinCounts.entries()].filter(([, c]) => c > 1);

  let amazonCdn = 0;
  let local = 0;
  let other = 0;
  for (const r of rows) {
    const img = (JSON.parse(r.images) as string[])[0] || "";
    if (img.startsWith("/products/")) local++;
    else if (/^https:\/\/(m\.media-amazon|images-na\.ssl-images-amazon)/.test(img)) amazonCdn++;
    else other++;
  }

  const byCat = await prisma.category.findMany({
    select: { slug: true, _count: { select: { products: true } } },
  });

  console.log({
    total,
    uniqueAsins: asinCounts.size,
    duplicateAsins: dupAsins.length,
    images: { local, amazonCdn, other },
    byCategory: Object.fromEntries(byCat.map((c) => [c.slug, c._count.products])),
  });
  if (dupAsins.length) console.log("dups:", dupAsins.slice(0, 10));
}

main().finally(() => prisma.$disconnect());
