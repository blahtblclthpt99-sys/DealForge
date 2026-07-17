import { PrismaClient } from "@prisma/client";
import { buildAliExpressAffiliateUrl } from "../src/lib/affiliate/aliexpress-config";
import { buildEbayAffiliateUrl } from "../src/lib/affiliate/ebay-config";

async function main() {
  const p = new PrismaClient();
  const ebay = await p.product.findFirst({ where: { retailer: "ebay" } });
  const ali = await p.product.findFirst({ where: { retailer: "aliexpress" } });
  console.log({
    ebay: { id: ebay?.id, title: ebay?.title, go: `/go/${ebay?.id}` },
    aliexpress: { id: ali?.id, title: ali?.title, go: `/go/${ali?.id}` },
    ebayLive: buildEbayAffiliateUrl({ url: ebay?.affiliateUrl }).slice(0, 100),
    aliLive: buildAliExpressAffiliateUrl({
      url: ali?.affiliateUrl,
      query: ali?.title,
    }).slice(0, 120),
  });
  await p.$disconnect();
}

main();
