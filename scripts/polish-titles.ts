/** Strip Amazon suffix noise from scraped titles. */
import { PrismaClient } from "@prisma/client";
import { slugify } from "../src/lib/utils";

function cleanTitle(raw: string) {
  return raw
    .replace(/^Amazon\.com\s*[-–:]\s*/i, "")
    .replace(/\s*:\s*Amazon\.com.*$/i, "")
    .replace(/\s*-\s*Amazon\.com.*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

async function main() {
  const p = new PrismaClient();
  const rows = await p.product.findMany({
    where: {
      OR: [
        { title: { contains: "Amazon.com" } },
        { title: { contains: ": Patio" } },
        { title: { contains: ": Cell Phones" } },
        { title: { contains: ": Musical" } },
        { title: { contains: ": Electr" } },
      ],
    },
    select: { id: true, asin: true, title: true },
  });
  for (const r of rows) {
    const title = cleanTitle(r.title);
    if (title === r.title) continue;
    await p.product.update({
      where: { id: r.id },
      data: {
        title,
        slug: `${slugify(title)}-${String(r.asin).toLowerCase()}`.slice(0, 180),
        description: `${title} — available on Amazon. DealForge links with Associates tag titanfieldos-20.`,
      },
    });
    console.log(r.asin, title.slice(0, 70));
  }
  await p.cacheEntry.deleteMany();
  await p.$disconnect();
}

main();
