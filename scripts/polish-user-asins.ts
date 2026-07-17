import { PrismaClient } from "@prisma/client";
import { slugify } from "../src/lib/utils";

const fixes: Array<[string, string]> = [
  [
    "B0DZM1WVCS",
    "Bajío Zapata Polarized Polycarbonate Sunglasses - Brown Grass Matte / Blue Mirror",
  ],
  [
    "B0DYLG399L",
    "Bajío Stiltsville Polarized Sunglasses - Green Grass Matte / Green Mirror Glass",
  ],
  ["B0CRH74TD6", "LASTING PINNIP Mens Steel-Toe Waterproof Work Boots"],
  [
    "B0FD8D9NJF",
    "Marc Joseph New York Mens Charles Ave Sneakers (Hands-Free Technology)",
  ],
  [
    "B01BA54YGO",
    "Maui Jim Men's & Women's Castles Polarized Teardrop Sunglasses",
  ],
];

async function main() {
  const p = new PrismaClient();
  for (const [asin, title] of fixes) {
    await p.product.updateMany({
      where: { asin },
      data: {
        title,
        slug: `${slugify(title)}-${asin.toLowerCase()}`,
        description: `${title} — available on Amazon. DealForge links with Associates tag titanfieldos-20.`,
      },
    });
  }
  const rows = await p.product.findMany({
    where: {
      asin: {
        in: ["B0DZM1WVCS", "B0DYLG399L", "B01BA54YGO", "B0FD8D9NJF", "B0CRH74TD6"],
      },
    },
    select: { asin: true, title: true, price: true, brand: true, affiliateUrl: true },
  });
  for (const r of rows) {
    console.log(`${r.asin}  $${r.price}  ${r.brand} — ${r.title}`);
    console.log(`  ${r.affiliateUrl}`);
  }
  await p.$disconnect();
}

main();
