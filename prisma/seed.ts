import { readFileSync } from "fs";
import path from "path";
import { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { amazonDpLink } from "../src/lib/affiliate/providers/amazon";
import { AMAZON_ASSOCIATE_TAG } from "../src/lib/affiliate/amazon-config";
import {
  buildEbayAffiliateUrl,
  EBAY_AFFILIATE_SID,
  EBAY_AFFILIATE_TRACKING_ID,
} from "../src/lib/affiliate/ebay-config";
import {
  buildAliExpressAffiliateUrl,
  ALIEXPRESS_AFF_SHORT_KEY,
  ALIEXPRESS_PUBLISHER_ID,
} from "../src/lib/affiliate/aliexpress-config";
import { slugify } from "../src/lib/utils";
import { inferClothingSubcategory } from "../src/lib/clothing-subcategory";

const prisma = new PrismaClient();

const CATEGORIES = [
  { name: "Electronics", slug: "electronics", icon: "cpu" },
  { name: "Home & Kitchen", slug: "home-kitchen", icon: "home" },
  { name: "Tools", slug: "tools", icon: "wrench" },
  { name: "Automotive", slug: "automotive", icon: "car" },
  { name: "Gaming", slug: "gaming", icon: "gamepad-2" },
  { name: "Clothing", slug: "clothing", icon: "shirt" },
  { name: "Beauty", slug: "beauty", icon: "sparkles" },
  { name: "Pet Supplies", slug: "pet-supplies", icon: "paw-print" },
  { name: "Office", slug: "office", icon: "briefcase" },
  { name: "Outdoor", slug: "outdoor", icon: "tree-pine" },
  { name: "Sports", slug: "sports", icon: "dumbbell" },
  { name: "Toys", slug: "toys", icon: "puzzle" },
  { name: "Grocery", slug: "grocery", icon: "shopping-basket" },
  { name: "Books", slug: "books", icon: "book-open" },
] as const;

type CatalogProduct = {
  asin: string;
  category: string;
  title: string;
  brand: string;
  image: string;
  images?: string[];
  price: number;
  originalPrice: number;
  rating: number;
  reviewCount: number;
  featured?: boolean;
  flash?: boolean;
  trending?: number;
};

type EbayCatalogItem = {
  itemId: string | null;
  searchUrl: string;
  category: string;
  title: string;
  brand: string;
  image?: string;
  images?: string[];
  price: number;
  originalPrice: number;
  rating: number;
  reviewCount: number;
  featured?: boolean;
  flash?: boolean;
};

type AliExpressCatalogItem = {
  productId: string | null;
  searchUrl: string;
  category: string;
  title: string;
  brand: string;
  image?: string;
  images?: string[];
  price: number;
  originalPrice: number;
  rating: number;
  reviewCount: number;
  featured?: boolean;
  flash?: boolean;
};

function loadJson<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), file), "utf8")) as T;
}

function loadJsonOptional<T>(file: string, fallback: T): T {
  try {
    return loadJson<T>(file);
  } catch {
    return fallback;
  }
}

function cleanAsin(asin: string) {
  return asin.split(/-X|-GAME|-BEAU|-SOCK|-AUTO|-HOME/)[0];
}

function productImages(p: { image: string; images?: string[] }) {
  const list = (p.images?.length ? p.images : [p.image]).filter(Boolean);
  return Array.from(new Set(list));
}

async function main() {
  const amazonCatalog = [
    ...loadJson<CatalogProduct[]>("prisma/amazon-catalog.json"),
    ...loadJsonOptional<CatalogProduct[]>("prisma/amazon-discovered.json", []),
    ...loadJsonOptional<CatalogProduct[]>("prisma/amazon-bulk.json", []),
    ...loadJsonOptional<CatalogProduct[]>("prisma/clothing-catalog.json", []),
  ];
  const ebayCatalog = loadJson<EbayCatalogItem[]>("prisma/ebay-catalog.json");
  const aliCatalog = loadJson<AliExpressCatalogItem[]>("prisma/aliexpress-catalog.json");

  console.log(
    `Seeding DealForge — Amazon ${amazonCatalog.length}, eBay ${ebayCatalog.length}, AliExpress ${aliCatalog.length}`,
  );

  await prisma.clickEvent.deleteMany();
  await prisma.apiUsageLog.deleteMany();
  await prisma.systemLog.deleteMany();
  await prisma.importJob.deleteMany();
  await prisma.cacheEntry.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.affiliateProvider.deleteMany();
  await prisma.user.deleteMany();

  for (const cat of CATEGORIES) {
    await prisma.category.create({ data: cat });
  }

  const categories = await prisma.category.findMany();
  const bySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));

  let created = 0;
  const seenAsins = new Set<string>();
  const seenSlugs = new Set<string>();
  const amazonRows: Prisma.ProductCreateManyInput[] = [];
  let skippedDuplicates = 0;

  for (const p of amazonCatalog) {
    const realAsin = cleanAsin(p.asin);
    if (seenAsins.has(realAsin)) {
      skippedDuplicates += 1;
      continue;
    }
    seenAsins.add(realAsin);

    let slug = `${slugify(p.title)}-${realAsin.toLowerCase()}`.slice(0, 180);
    if (seenSlugs.has(slug)) slug = `${slug}-${seenAsins.size}`;
    seenSlugs.add(slug);

    const category = bySlug[p.category] || bySlug.electronics;
    const subcategory =
      category.slug === "clothing" ? inferClothingSubcategory(p.title, p.brand) : null;
    const discountPercent =
      p.originalPrice > p.price
        ? Math.round(((p.originalPrice - p.price) / p.originalPrice) * 1000) / 10
        : 0;
    const affiliateUrl = amazonDpLink(realAsin);
    const images = productImages(p);

    amazonRows.push({
      asin: realAsin,
      slug,
      title: p.title,
      description: `${p.title} — available on Amazon via DealForge.`,
      brand: p.brand,
      categoryId: category.id,
      subcategory,
      images: JSON.stringify(images),
      price: p.price,
      originalPrice: p.originalPrice,
      discountPercent,
      rating: p.rating,
      reviewCount: p.reviewCount,
      affiliateUrl,
      retailer: "amazon",
      availability: "in_stock",
      specifications: JSON.stringify({
        Brand: p.brand,
        ASIN: realAsin,
        Retailer: "Amazon",
        ...(subcategory ? { Department: subcategory } : {}),
      }),
      trendingScore: p.trending ?? Math.random() * 40 + 50,
      clickCount: Math.floor(Math.random() * 400),
      viewCount: Math.floor(Math.random() * 4000) + 200,
      isFeatured: Boolean(p.featured),
      isFlashDeal: Boolean(p.flash),
      flashEndsAt: p.flash ? new Date(Date.now() + 1000 * 60 * 60 * 18) : null,
    });
  }

  const CHUNK = 400;
  for (let i = 0; i < amazonRows.length; i += CHUNK) {
    const batch = await prisma.product.createMany({ data: amazonRows.slice(i, i + CHUNK) });
    created += batch.count;
  }
  if (skippedDuplicates) console.log(`skipped ${skippedDuplicates} duplicate ASINs`);

  for (const [i, item] of ebayCatalog.entries()) {
    const category = bySlug[item.category] || bySlug.electronics;
    const discountPercent =
      item.originalPrice > item.price
        ? Math.round(((item.originalPrice - item.price) / item.originalPrice) * 1000) / 10
        : 0;
    const images = productImages({
      image: item.image || "/images/placeholder-product.svg",
      images: item.images,
    });

    await prisma.product.create({
      data: {
        asin: item.itemId,
        slug: `${slugify(item.title)}-ebay-${i + 1}`,
        title: item.title,
        description: `${item.title}. Shop on eBay via DealForge Partner Network links.`,
        brand: item.brand,
        categoryId: category.id,
        images: JSON.stringify(images),
        price: item.price,
        originalPrice: item.originalPrice,
        discountPercent,
        rating: item.rating,
        reviewCount: item.reviewCount,
        affiliateUrl: item.searchUrl,
        retailer: "ebay",
        availability: "in_stock",
        specifications: JSON.stringify({
          Brand: item.brand,
          Retailer: "eBay",
          Network: "eBay Partner Network",
        }),
        trendingScore: Math.random() * 40 + 45,
        clickCount: Math.floor(Math.random() * 200),
        viewCount: Math.floor(Math.random() * 2000) + 100,
        isFeatured: Boolean(item.featured),
        isFlashDeal: Boolean(item.flash),
        flashEndsAt: item.flash ? new Date(Date.now() + 1000 * 60 * 60 * 20) : null,
      },
    });
    created += 1;
  }

  for (const [i, item] of aliCatalog.entries()) {
    const category = bySlug[item.category] || bySlug.electronics;
    const discountPercent =
      item.originalPrice > item.price
        ? Math.round(((item.originalPrice - item.price) / item.originalPrice) * 1000) / 10
        : 0;
    const images = productImages({
      image: item.image || "/images/placeholder-product.svg",
      images: item.images,
    });

    await prisma.product.create({
      data: {
        asin: item.productId,
        slug: `${slugify(item.title)}-aliexpress-${i + 1}`,
        title: item.title,
        description: `${item.title}. Shop on AliExpress via DealForge affiliate links.`,
        brand: item.brand,
        categoryId: category.id,
        images: JSON.stringify(images),
        price: item.price,
        originalPrice: item.originalPrice,
        discountPercent,
        rating: item.rating,
        reviewCount: item.reviewCount,
        affiliateUrl: item.searchUrl,
        retailer: "aliexpress",
        availability: "in_stock",
        specifications: JSON.stringify({
          Brand: item.brand,
          Retailer: "AliExpress",
          Network: "AliExpress Affiliate",
        }),
        trendingScore: Math.random() * 40 + 40,
        clickCount: Math.floor(Math.random() * 180),
        viewCount: Math.floor(Math.random() * 1800) + 80,
        isFeatured: Boolean(item.featured),
        isFlashDeal: Boolean(item.flash),
        flashEndsAt: item.flash ? new Date(Date.now() + 1000 * 60 * 60 * 22) : null,
      },
    });
    created += 1;
  }

  const adminPassword = process.env.ADMIN_PASSWORD || "AdminDealForge2026!";
  await prisma.user.create({
    data: {
      name: "DealForge Admin",
      email: (process.env.ADMIN_EMAIL || "admin@dealforge.com").toLowerCase(),
      passwordHash: await bcrypt.hash(adminPassword, 12),
      role: "admin",
    },
  });
  await prisma.user.create({
    data: {
      name: "Demo Shopper",
      email: "demo@dealforge.com",
      passwordHash: await bcrypt.hash("DemoUser123!", 12),
      role: "user",
    },
  });

  await prisma.affiliateProvider.create({
    data: {
      provider: "amazon",
      displayName: "Amazon Associates",
      trackingId: AMAZON_ASSOCIATE_TAG,
      enabled: true,
      apiCredentials: JSON.stringify({ tag: AMAZON_ASSOCIATE_TAG }),
      lastSyncStatus: "ready",
    },
  });

  await prisma.affiliateProvider.create({
    data: {
      provider: "ebay",
      displayName: "eBay Partner Network",
      trackingId: EBAY_AFFILIATE_SID || "",
      enabled: Boolean(EBAY_AFFILIATE_SID),
      apiCredentials: JSON.stringify({
        sid: EBAY_AFFILIATE_SID,
        trackingId: EBAY_AFFILIATE_TRACKING_ID,
      }),
      lastSyncStatus: EBAY_AFFILIATE_SID ? "ready" : "disabled",
    },
  });

  await prisma.affiliateProvider.create({
    data: {
      provider: "aliexpress",
      displayName: "AliExpress Affiliate",
      trackingId: ALIEXPRESS_AFF_SHORT_KEY || ALIEXPRESS_PUBLISHER_ID || "",
      enabled: true,
      apiCredentials: JSON.stringify({
        affShortKey: ALIEXPRESS_AFF_SHORT_KEY,
        publisherId: ALIEXPRESS_PUBLISHER_ID,
      }),
      lastSyncStatus: ALIEXPRESS_AFF_SHORT_KEY ? "ready" : "links-active",
    },
  });

  for (const provider of ["walmart", "cj", "impact", "awin", "rakuten", "shareasale", "etsy"]) {
    await prisma.affiliateProvider.create({
      data: {
        provider,
        displayName: provider,
        trackingId: "",
        enabled: false,
        lastSyncStatus: "disabled",
      },
    });
  }

  await prisma.importJob.create({
    data: {
      provider: "amazon+ebay",
      status: "success",
      itemsTotal: created,
      itemsSuccess: created,
      itemsFailed: 0,
      errorLog: "[]",
      startedAt: new Date(Date.now() - 60000),
      finishedAt: new Date(),
    },
  });

  await prisma.systemLog.create({
    data: {
      level: "info",
      source: "seed",
      message: `Seeded ${created} products with attached images (Amazon + eBay)`,
    },
  });

  console.log(`Seeded ${created} products with attached product photos.`);
  console.log(`Sample Amazon link: ${amazonDpLink("B09XS7JWHH")}`);
  if (EBAY_AFFILIATE_SID) {
    console.log(
      `Sample eBay link: ${buildEbayAffiliateUrl({ url: "https://www.ebay.com/sch/i.html?_nkw=headphones" }).slice(0, 90)}…`,
    );
  }
  console.log(
    `Sample AliExpress link: ${buildAliExpressAffiliateUrl({ query: "wireless earbuds" }).slice(0, 100)}…`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
