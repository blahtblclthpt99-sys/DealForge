/**
 * Remove one or more dead ASINs from the DB + discovered/bulk catalogs.
 * Usage: npx tsx scripts/remove-asins.ts B071JD99LS ...
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const ASINS = process.argv.slice(2).map((a) => a.toUpperCase()).filter(Boolean);
if (!ASINS.length) {
  console.error("Pass ASINs to remove");
  process.exit(1);
}

async function main() {
  const prisma = new PrismaClient();
  const removed = await prisma.product.deleteMany({ where: { asin: { in: ASINS } } });
  console.log(`Removed ${removed.count} product(s) from DB`);

  for (const file of [
    "prisma/amazon-discovered.json",
    "prisma/amazon-bulk.json",
    "prisma/amazon-catalog.json",
  ]) {
    const full = path.join(process.cwd(), file);
    if (!existsSync(full)) continue;
    const list = JSON.parse(readFileSync(full, "utf8")) as Array<{ asin: string }>;
    const next = list.filter((p) => !ASINS.includes(String(p.asin || "").toUpperCase()));
    if (next.length !== list.length) {
      writeFileSync(full, JSON.stringify(next, null, file.includes("bulk") ? 1 : 2));
      console.log(`${file}: ${list.length - next.length} removed`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
