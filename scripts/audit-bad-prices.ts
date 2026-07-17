import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const target = await p.product.findFirst({
    where: { asin: "B0CKZ4ZWYG" },
    select: {
      id: true,
      asin: true,
      title: true,
      price: true,
      originalPrice: true,
      discountPercent: true,
      slug: true,
    },
  });
  console.log("TARGET", target);

  const bad = await p.product.findMany({
    where: {
      OR: [
        { discountPercent: { gte: 80 } },
        { price: { lte: 1 } },
        { AND: [{ originalPrice: { gt: 0 } }, { price: { lt: 5 } }, { originalPrice: { gt: 100 } }] },
      ],
    },
    select: {
      asin: true,
      title: true,
      price: true,
      originalPrice: true,
      discountPercent: true,
    },
    orderBy: { discountPercent: "desc" },
    take: 40,
  });
  console.log("\nBAD SAMPLE", bad.length);
  for (const r of bad) {
    console.log(
      `${r.discountPercent}%  $${r.price} / $${r.originalPrice}  ${r.asin}  ${r.title.slice(0, 50)}`,
    );
  }

  const counts = {
    discount100: await p.product.count({ where: { discountPercent: { gte: 99.5 } } }),
    discount90: await p.product.count({ where: { discountPercent: { gte: 90 } } }),
    discount80: await p.product.count({ where: { discountPercent: { gte: 80 } } }),
    priceUnder1: await p.product.count({ where: { price: { lte: 1 } } }),
    total: await p.product.count(),
  };
  console.log("\nCOUNTS", counts);
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
