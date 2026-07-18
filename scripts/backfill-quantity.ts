/**
 * Backfill Product.quantity from titles (Count / Pack of / Total / etc.).
 * Usage: npx tsx scripts/backfill-quantity.ts
 */
import { PrismaClient } from "@prisma/client";
import { parseQuantityFromTitle } from "../src/lib/quantity";

const prisma = new PrismaClient();
const BATCH = 200;

async function main() {
  let skip = 0;
  let updated = 0;
  let scanned = 0;

  for (;;) {
    const rows = await prisma.product.findMany({
      select: { id: true, title: true, quantity: true },
      orderBy: { id: "asc" },
      skip,
      take: BATCH,
    });
    if (!rows.length) break;
    skip += rows.length;

    for (const row of rows) {
      scanned++;
      const q = parseQuantityFromTitle(row.title);
      if (q == null) continue;
      if (row.quantity === q) continue;
      await prisma.product.update({ where: { id: row.id }, data: { quantity: q } });
      updated++;
    }
    console.log(`scanned=${scanned} updated=${updated}`);
  }

  await prisma.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });
  console.log(`Done. scanned=${scanned} updated=${updated}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
