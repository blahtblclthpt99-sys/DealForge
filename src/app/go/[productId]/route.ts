import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { generateAffiliateLink } from "@/lib/affiliate/registry";
import { buildAmazonProductUrl } from "@/lib/affiliate/amazon-config";
import { buildEbayAffiliateUrl } from "@/lib/affiliate/ebay-config";
import { buildAliExpressAffiliateUrl } from "@/lib/affiliate/aliexpress-config";
import { prisma } from "@/lib/db";
import { recordClick } from "@/lib/products";
import { publicProductWhere } from "@/lib/product-visibility";

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

function normalizeRetailer(value: string) {
  return value.trim().toLowerCase();
}

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
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function safeStoredRetailerUrl(retailer: string, value: string | null | undefined) {
  const normalized = normalizeRetailer(retailer);
  return allowedHttpsUrl(value, RETAILER_DESTINATION_HOSTS[normalized] ?? []);
}

function safeFinalDestination(retailer: string, value: string) {
  const normalized = normalizeRetailer(retailer);
  const allowed = [
    ...(RETAILER_DESTINATION_HOSTS[normalized] ?? []),
    ...(TRACKING_DESTINATION_HOSTS[normalized] ?? []),
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
 * Only products that pass the same public visibility policy as the storefront
 * are eligible for an outbound redirect.
 */
export async function GET(_req: Request, { params }: Props) {
  const { productId } = await params;
  const product = await prisma.product.findFirst({
    where: publicProductWhere({ id: productId }),
  });

  if (!product) {
    return NextResponse.redirect(new URL("/", appBase()), 302);
  }

  const session = await readSession();
  try {
    await recordClick(product.id, session?.id);
  } catch {
    // Click tracking must never block the shopper.
  }

  const retailer = normalizeRetailer(product.retailer);
  let destination: string;
  if (retailer === "amazon" && product.asin) {
    destination = buildAmazonProductUrl(product.asin);
  } else if (retailer === "ebay") {
    destination = buildEbayAffiliateUrl({
      itemId: product.asin,
      url: safeStoredRetailerUrl(retailer, product.affiliateUrl) ?? undefined,
    });
  } else if (retailer === "aliexpress") {
    destination = buildAliExpressAffiliateUrl({
      productId: product.asin,
      url: safeStoredRetailerUrl(retailer, product.affiliateUrl) ?? undefined,
      query: product.title,
    });
  } else {
    destination = generateAffiliateLink(retailer, {
      asin: product.asin,
      externalId: product.asin,
      url: safeStoredRetailerUrl(retailer, product.affiliateUrl),
    });
  }

  const safeDestination = safeFinalDestination(retailer, destination);
  if (!safeDestination) {
    return NextResponse.redirect(storefrontFallback(product.slug), 302);
  }

  return NextResponse.redirect(safeDestination, 302);
}
