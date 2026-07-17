import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const row = await p.product.findFirst({
    where: { asin: "B09RSSM4R7" },
    select: { id: true, asin: true, price: true, originalPrice: true, discountPercent: true, title: true },
  });
  console.log("suspect", row);
  if (row && row.price < 5 && row.title.toLowerCase().includes("thrush")) {
    // Restore a sane price from prior (~$47.95) until next good scrape
    await p.product.update({
      where: { id: row.id },
      data: { price: 47.95, originalPrice: 47.95, discountPercent: 0 },
    });
    console.log("restored Thrush Treatment to $47.95");
  }

  // Neutralize any discount that still looks absurd after refresh
  const bad = await p.product.findMany({
    where: {
      OR: [
        { discountPercent: { gte: 70 } },
        { AND: [{ price: { gt: 0 } }, { originalPrice: { gt: 0 } }] },
      ],
    },
    select: { id: true, price: true, originalPrice: true, discountPercent: true, asin: true },
  });
  let fixed = 0;
  for (const r of bad) {
    if (r.originalPrice > r.price * 2.5 || r.discountPercent >= 70) {
      await p.product.update({
        where: { id: r.id },
        data: { originalPrice: r.price, discountPercent: 0 },
      });
      fixed++;
      console.log("cleared", r.asin, r.discountPercent, r.price, r.originalPrice);
    }
  }
  console.log({
    fixed,
    discount80: await p.product.count({ where: { discountPercent: { gte: 80 } } }),
  });
  await p.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
