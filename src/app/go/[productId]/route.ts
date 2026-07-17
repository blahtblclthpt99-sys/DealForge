import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { generateAffiliateLink } from "@/lib/affiliate/registry";
import { buildAmazonProductUrl } from "@/lib/affiliate/amazon-config";
import { buildEbayAffiliateUrl } from "@/lib/affiliate/ebay-config";
import { buildAliExpressAffiliateUrl } from "@/lib/affiliate/aliexpress-config";
import { prisma } from "@/lib/db";
import { recordClick } from "@/lib/products";

type Props = { params: Promise<{ productId: string }> };

/**
 * Outbound affiliate redirect.
 * Rebuilds tracked Amazon / eBay / AliExpress links at click-time.
 */
export async function GET(_req: Request, { params }: Props) {
  const { productId } = await params;
  const product = await prisma.product.findUnique({ where: { id: productId } });

  if (!product) {
    return NextResponse.redirect(new URL("/", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"));
  }

  const session = await readSession();
  try {
    await recordClick(product.id, session?.id);
  } catch {
    // click tracking must not block the shopper
  }

  let destination: string;
  if (product.retailer === "amazon" && product.asin) {
    destination = buildAmazonProductUrl(product.asin);
  } else if (product.retailer === "ebay") {
    destination = buildEbayAffiliateUrl({
      itemId: product.asin,
      url: product.affiliateUrl.includes("ebay.com") ? product.affiliateUrl : undefined,
    });
  } else if (product.retailer === "aliexpress") {
    destination = buildAliExpressAffiliateUrl({
      productId: product.asin,
      url: product.affiliateUrl.includes("aliexpress.com") ? product.affiliateUrl : undefined,
      query: product.title,
    });
  } else {
    destination = generateAffiliateLink(product.retailer, {
      asin: product.asin,
      externalId: product.asin,
      url: product.affiliateUrl,
    });
  }

  return NextResponse.redirect(destination, 302);
}
