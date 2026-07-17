import { PrismaClient } from "@prisma/client";
import { buildEbayAffiliateUrl } from "../src/lib/affiliate/ebay-config";

async function main() {
  const p = new PrismaClient();
  const row = await p.product.findFirst({ where: { retailer: "ebay" } });
  if (!row) {
    console.error("No eBay product found");
    process.exit(1);
  }
  console.log({
    id: row.id,
    title: row.title,
    go: `/go/${row.id}`,
    live: buildEbayAffiliateUrl({ url: "https://www.ebay.com/sch/i.html?_nkw=headphones" }).slice(0, 180),
  });
  await p.$disconnect();
}

main();
