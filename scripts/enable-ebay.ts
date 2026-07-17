/**
 * Enable eBay Partner Network and seed eBay deal products without wiping Amazon data.
 * Run: npx tsx scripts/enable-ebay.ts
 */
import { readFileSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { buildEbayAffiliateUrl, EBAY_AFFILIATE_SID, EBAY_AFFILIATE_TRACKING_ID } from "../src/lib/affiliate/ebay-config";
import { slugify } from "../src/lib/utils";

const prisma = new PrismaClient();

type EbayCatalogItem = {
  itemId: string | null;
  searchUrl: string;
  category: string;
  title: string;
  brand: string;
  price: number;
  originalPrice: number;
  rating: number;
  reviewCount: number;
  featured?: boolean;
  flash?: boolean;
  hue: number;
};

function ebayCardImage(hue: number, title: string) {
  const safe = encodeURIComponent(title.slice(0, 32));
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="hsl(${hue} 55% 42%)"/>
          <stop offset="100%" stop-color="hsl(210 70% 28%)"/>
        </linearGradient>
      </defs>
      <rect width="800" height="800" fill="url(#g)"/>
      <rect x="48" y="48" width="160" height="56" rx="12" fill="#e53238"/>
      <text x="128" y="84" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-size="28" font-weight="700">eBay</text>
      <text x="400" y="420" text-anchor="middle" fill="white" font-family="Georgia, serif" font-size="30">${safe}</text>
    </svg>`,
  )}`;
}

async function main() {
  if (!EBAY_AFFILIATE_SID) {
    throw new Error("EBAY_AFFILIATE_SID is missing from .env");
  }

  console.log(`Enabling eBay Partner Network (sid=${EBAY_AFFILIATE_SID.slice(0, 8)}…)`);

  await prisma.affiliateProvider.upsert({
    where: { provider: "ebay" },
    create: {
      provider: "ebay",
      displayName: "eBay Partner Network",
      trackingId: EBAY_AFFILIATE_SID,
      enabled: true,
      apiCredentials: JSON.stringify({
        sid: EBAY_AFFILIATE_SID,
        trackingId: EBAY_AFFILIATE_TRACKING_ID,
      }),
      lastSyncStatus: "ready",
    },
    update: {
      displayName: "eBay Partner Network",
      trackingId: EBAY_AFFILIATE_SID,
      enabled: true,
      apiCredentials: JSON.stringify({
        sid: EBAY_AFFILIATE_SID,
        trackingId: EBAY_AFFILIATE_TRACKING_ID,
      }),
      lastSyncStatus: "ready",
    },
  });

  // Remove previous eBay seed rows so re-runs stay clean
  await prisma.product.deleteMany({ where: { retailer: "ebay" } });

  const catalog = JSON.parse(
    readFileSync(path.join(process.cwd(), "prisma", "ebay-catalog.json"), "utf8"),
  ) as EbayCatalogItem[];

  const categories = await prisma.category.findMany();
  const bySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));

  let created = 0;
  for (const item of catalog) {
    const category = bySlug[item.category] || bySlug.electronics;
    const discountPercent =
      item.originalPrice > item.price
        ? Math.round(((item.originalPrice - item.price) / item.originalPrice) * 1000) / 10
        : 0;
    const affiliateUrl = item.searchUrl;
    const slug = `${slugify(item.title)}-ebay-${created + 1}`;

    await prisma.product.create({
      data: {
        asin: item.itemId,
        slug,
        title: item.title,
        description: `${item.title}. Shop this deal on eBay. DealForge earns from qualifying purchases through the eBay Partner Network.`,
        brand: item.brand,
        categoryId: category.id,
        images: JSON.stringify([ebayCardImage(item.hue, item.title)]),
        price: item.price,
        originalPrice: item.originalPrice,
        discountPercent,
        rating: item.rating,
        reviewCount: item.reviewCount,
        affiliateUrl,
        retailer: "ebay",
        availability: "in_stock",
        specifications: JSON.stringify({
          Retailer: "eBay",
          Network: "eBay Partner Network",
          SID: EBAY_AFFILIATE_SID,
        }),
        trendingScore: Math.random() * 40 + 55,
        clickCount: Math.floor(Math.random() * 200),
        viewCount: Math.floor(Math.random() * 2000) + 100,
        isFeatured: Boolean(item.featured),
        isFlashDeal: Boolean(item.flash),
        flashEndsAt: item.flash ? new Date(Date.now() + 1000 * 60 * 60 * 20) : null,
      },
    });
    created += 1;
    console.log(`  + ${item.title}`);
    console.log(`    go → ${buildEbayAffiliateUrl({ url: item.searchUrl }).slice(0, 100)}…`);
  }

  await prisma.systemLog.create({
    data: {
      level: "info",
      source: "affiliate",
      message: `eBay Partner Network enabled with SID; seeded ${created} eBay deals`,
    },
  });

  console.log(`Done. Enabled eBay and added ${created} products.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
