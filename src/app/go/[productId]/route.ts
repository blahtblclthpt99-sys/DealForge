import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { generateAffiliateLink } from "@/lib/affiliate/registry";
import { buildAmazonProductUrl } from "@/lib/affiliate/amazon-config";
import { buildEbayAffiliateUrl } from "@/lib/affiliate/ebay-config";
import { buildAliExpressAffiliateUrl } from "@/lib/affiliate/aliexpress-config";
import { prisma } from "@/lib/db";
import { recordClick } from "@/lib/products";
import { isStorefrontBlockedSpecifications } from "@/lib/product-visibility";

type Props = { params: Promise<{ productId: string }> };

const RETAILER_DESTINATION_HOSTS: Record<string, string[]> = {
  amazon: ["amazon.com"],
  walmart: ["walmart.com"],
  ebay: ["ebay.com"],
  aliexpress: ["aliexpress.com"],
  cj: ["cj.com"],
  impact: ["impact.com"],
  awin: ["awin.com"],
  rakuten: ["rakutenadvertising.com"],
  shareasale: ["shareasale.com"],
  etsy: ["etsy.com"],
};

const TRACKING_DESTINATION_HOSTS: Record<string, string[]> = {
  ebay: ["rover.ebay.com"],
  aliexpress: ["s.click.aliexpress.com"],
};

function hostnameMatches(hostname: string, allowed: string) {
  const host = hostname.toLowerCase();
  const suffix = allowed.toLowerCase();
  return host === suffix || host.endsWith(`.${suffix}`);
}

function allowedHttpsUrl(value: string | null | undefined, allowedHosts: string[]) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (url.port && url.port !== "443") return null;
    if (!allowedHosts.some((host) => hostnameMatches(url.hostname, host))) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safeStoredRetailerUrl(retailer: string, value: string | null | undefined) {
  return allowedHttpsUrl(value, RETAILER_DESTINATION_HOSTS[retailer] ?? []);
}

function safeFinalDestination(retailer: string, value: string) {
  const allowed = [
    ...(RETAILER_DESTINATION_HOSTS[retailer] ?? []),
    ...(TRACKING_DESTINATION_HOSTS[retailer] ?? []),
  ];
  return allowedHttpsUrl(value, allowed);
}

function appBase() {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

function storefrontFallback(productSlug: string) {
  return new URL(`/product/${encodeURIComponent(productSlug)}`, appBase());
}

/**
 * Outbound affiliate redirect.
 * Rebuilds tracked retailer links at click-time and validates every final host.
 */
export async function GET(_req: Request, { params }: Props) {
  const { productId } = await params;
  const product = await prisma.product.findUnique({ where: { id: productId } });

  if (!product || isStorefrontBlockedSpecifications(product.specifications)) {
    return NextResponse.redirect(new URL("/", appBase()), 302);
  }

  const session = await readSession();
  try {
    await recordClick(product.id, session?.id);
  } catch {
    // Click tracking must never block the shopper.
  }

  let destination: string;
  if (product.retailer === "amazon" && product.asin) {
    destination = buildAmazonProductUrl(product.asin);
  } else if (product.retailer === "ebay") {
    destination = buildEbayAffiliateUrl({
      itemId: product.asin,
      url: safeStoredRetailerUrl("ebay", product.affiliateUrl) ?? undefined,
    });
  } else if (product.retailer === "aliexpress") {
    destination = buildAliExpressAffiliateUrl({
      productId: product.asin,
      url: safeStoredRetailerUrl("aliexpress", product.affiliateUrl) ?? undefined,
      query: product.title,
    });
  } else {
    destination = generateAffiliateLink(product.retailer, {
      asin: product.asin,
      externalId: product.asin,
      url: safeStoredRetailerUrl(product.retailer, product.affiliateUrl),
    });
  }

  const safeDestination = safeFinalDestination(product.retailer, destination);
  if (!safeDestination) {
    return NextResponse.redirect(storefrontFallback(product.slug), 302);
  }

  return NextResponse.redirect(safeDestination, 302);
}
