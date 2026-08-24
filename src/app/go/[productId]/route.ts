import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { generateAffiliateLink } from "@/lib/affiliate/registry";
import { buildAmazonProductUrl } from "@/lib/affiliate/amazon-config";
import { buildEbayAffiliateUrl } from "@/lib/affiliate/ebay-config";
import { buildAliExpressAffiliateUrl } from "@/lib/affiliate/aliexpress-config";
import { prisma } from "@/lib/db";
import { recordClick } from "@/lib/products";
import { normalizeExternalHttpUrl } from "@/lib/url-security";

type Props = { params: Promise<{ productId: string }> };

function storefrontHome(request: Request) {
  return new URL("/", request.url);
}

/**
 * Outbound affiliate redirect.
 * Rebuilds tracked Amazon / eBay / AliExpress links at click-time.
 */
export async function GET(request: Request, { params }: Props) {
  const { productId } = await params;
  const product = await prisma.product.findUnique({ where: { id: productId } });

  if (!product) {
    return NextResponse.redirect(storefrontHome(request));
  }

  const session = await readSession();
  try {
    await recordClick(product.id, session?.id);
  } catch {
    // click tracking must not block the shopper
  }

  let destination: string;
  try {
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
  } catch (error) {
    console.error("affiliate.redirect.build_failed", {
      productId: product.id,
      retailer: product.retailer,
      error: error instanceof Error ? error.message : "UNKNOWN",
    });
    return NextResponse.redirect(storefrontHome(request));
  }

  const safeDestination = normalizeExternalHttpUrl(destination);
  if (!safeDestination) {
    console.error("affiliate.redirect.blocked_unsafe_destination", {
      productId: product.id,
      retailer: product.retailer,
    });
    return NextResponse.redirect(storefrontHome(request));
  }

  return NextResponse.redirect(safeDestination, 302);
}
