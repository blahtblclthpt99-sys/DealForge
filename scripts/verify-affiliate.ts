import { PrismaClient } from "@prisma/client";
import { buildAmazonProductUrl } from "../src/lib/affiliate/amazon-config";

async function main() {
  const p = new PrismaClient();
  const row = await p.product.findFirst({ where: { asin: "B09XS7JWHH" } });
  if (!row?.asin) {
    console.error("Product not found");
    process.exit(1);
  }
  console.log({
    id: row.id,
    title: row.title,
    asin: row.asin,
    affiliateUrl: row.affiliateUrl,
    live: buildAmazonProductUrl(row.asin),
    go: `/go/${row.id}`,
  });
  await p.$disconnect();
}

main();
