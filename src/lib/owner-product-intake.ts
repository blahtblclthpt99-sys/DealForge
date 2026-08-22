import { prisma } from "@/lib/db";
import { parseJson } from "@/lib/utils";
import { buildAmazonProductUrl } from "@/lib/affiliate/amazon-config";
import {
  amazonCreatorsConfigured,
  getAmazonCreatorItems,
  type AmazonCreatorItem,
} from "@/lib/affiliate/amazon-creators";

const ASIN_RE = /^[A-Z0-9]{10}$/;
const MAX_INPUT = 500;
const PLACEHOLDER_IMAGE = "/images/placeholder-product.svg";

export type OwnerIntakeResult = {
  asin: string;
  status: "published" | "queued" | "exists";
  productId: string;
  usedApprovedApi: boolean;
  message: string;
};

function cleanAsin(value: string) {
  return value.trim().toUpperCase();
}

export function extractAmazonAsin(raw: string) {
  const value = raw.trim().slice(0, MAX_INPUT);
  const plain = cleanAsin(value);
  if (ASIN_RE.test(plain)) return plain;

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const isAmazonHost = host === "amazon.com" || host.endsWith(".amazon.com");
    if (!isAmazonHost || url.protocol !== "https:") return null;

    const queryAsin = cleanAsin(url.searchParams.get("asin") || "");
    if (ASIN_RE.test(queryAsin)) return queryAsin;

    const match = url.pathname.toUpperCase().match(/\/(?:DP|GP\/PRODUCT|GP\/AW\/D|PRODUCT-REVIEWS)\/([A-Z0-9]{10})(?:[/?]|$)/);
    return match && ASIN_RE.test(match[1]) ? match[1] : null;
  } catch {
    return null;
  }
}

function inferCategorySlug(title: string) {
  const text = title.toLowerCase();
  const rules: Array<[string, string[]]> = [
    ["electronics", ["phone", "laptop", "tablet", "headphone", "earbud", "charger", "camera", "monitor", "keyboard"]],
    ["home-kitchen", ["kitchen", "vacuum", "cookware", "bedding", "furniture", "air fryer", "coffee"]],
    ["clothing", ["shirt", "dress", "shoe", "jacket", "jean", "apparel", "sneaker"]],
    ["beauty", ["beauty", "skin", "makeup", "shampoo", "cosmetic", "serum"]],
    ["toys-games", ["toy", "game", "lego", "puzzle"]],
    ["sports-outdoors", ["sport", "outdoor", "camp", "fitness", "golf", "exercise"]],
    ["baby", ["baby", "diaper", "infant", "toddler"]],
    ["books", ["book", "paperback", "hardcover", "kindle"]],
  ];
  return rules.find(([, words]) => words.some((word) => text.includes(word)))?.[0] || "other";
}

async function resolveCategory(title: string) {
  const inferred = inferCategorySlug(title);
  return (
    (await prisma.category.findFirst({ where: { slug: inferred }, select: { id: true } })) ||
    (await prisma.category.findFirst({ where: { slug: "other" }, select: { id: true } })) ||
    (await prisma.category.findFirst({ orderBy: { name: "asc" }, select: { id: true } }))
  );
}

function discountPercent(price: number, originalPrice: number) {
  if (!(price > 0) || !(originalPrice > price)) return 0;
  return Math.round(((originalPrice - price) / originalPrice) * 1000) / 10;
}

async function clearCatalogCaches() {
  await Promise.all([
    prisma.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } }),
    prisma.cacheEntry.deleteMany({ where: { key: { startsWith: "categories:" } } }),
  ]);
}

async function applyApprovedItem(productId: string, item: AmazonCreatorItem) {
  const current = await prisma.product.findUnique({ where: { id: productId } });
  if (!current) throw new Error("Product disappeared during enrichment");
  const category = await resolveCategory(item.title);
  if (!category) throw new Error("At least one category is required before adding products");

  const originalPrice = Math.max(item.originalPrice || item.price, item.price);
  const specs = parseJson<Record<string, unknown>>(current.specifications, {});
  const images = item.images?.length ? item.images : parseJson<string[]>(current.images, [PLACEHOLDER_IMAGE]);

  const updated = await prisma.product.update({
    where: { id: productId },
    data: {
      title: item.title || current.title,
      description: item.description || item.title || current.description,
      brand: item.brand || current.brand,
      categoryId: category.id,
      images: JSON.stringify(images.length ? images : [PLACEHOLDER_IMAGE]),
      price: item.price > 0 ? item.price : current.price,
      originalPrice: originalPrice > 0 ? originalPrice : current.originalPrice,
      discountPercent: discountPercent(item.price, originalPrice),
      affiliateUrl: buildAmazonProductUrl(item.asin),
      availability: item.availability || "unknown",
      isFlashDeal: discountPercent(item.price, originalPrice) >= 10,
      lastUpdated: new Date(item.checkedAt),
      specifications: JSON.stringify({
        ...specs,
        needsEnrichment: false,
        storefrontBlocked: false,
        intakeSource: "owner-asin",
        metadataSource: "amazon-creators-api",
        metadataCheckedAt: item.checkedAt,
        priceSource: "amazon-creators-api",
        priceCheckedAt: item.checkedAt,
      }),
    },
  });
  await clearCatalogCaches();
  return updated;
}

async function approvedItemFor(asin: string) {
  if (!amazonCreatorsConfigured()) return null;
  try {
    const items = await getAmazonCreatorItems([asin]);
    return items.find((item) => item.asin === asin) || null;
  } catch (error) {
    console.error("Owner ASIN enrichment failed", error);
    return null;
  }
}

export async function addOwnerAmazonProduct(raw: string): Promise<OwnerIntakeResult> {
  const asin = extractAmazonAsin(raw);
  if (!asin) throw new Error("Enter a valid 10-character Amazon ASIN or Amazon product URL");

  const existing = await prisma.product.findFirst({
    where: { retailer: "amazon", asin },
  });
  const item = await approvedItemFor(asin);

  if (existing && item) {
    const updated = await applyApprovedItem(existing.id, item);
    await prisma.systemLog.create({
      data: {
        level: "info",
        source: "owner-intake",
        message: `Owner refreshed Amazon ASIN ${asin}`,
      },
    });
    return {
      asin,
      status: "published",
      productId: updated.id,
      usedApprovedApi: true,
      message: "ASIN refreshed with approved Amazon product data and is ready for the storefront.",
    };
  }

  if (existing) {
    const specs = parseJson<Record<string, unknown>>(existing.specifications, {});
    const queued = specs.needsEnrichment === true;
    return {
      asin,
      status: queued ? "queued" : "exists",
      productId: existing.id,
      usedApprovedApi: false,
      message: queued
        ? "ASIN is already in your private enrichment queue."
        : "That ASIN already exists in the catalog.",
    };
  }

  const category = await resolveCategory(item?.title || "");
  if (!category) throw new Error("Create at least one category before adding products");

  const now = new Date();
  const base = {
    asin,
    slug: `amazon-${asin.toLowerCase()}`,
    categoryId: category.id,
    affiliateUrl: buildAmazonProductUrl(asin),
    retailer: "amazon",
  };

  let created;
  try {
    if (item) {
      const originalPrice = Math.max(item.originalPrice || item.price, item.price);
      created = await prisma.product.create({
        data: {
          ...base,
          title: item.title,
          description: item.description || item.title,
          brand: item.brand || "Amazon",
          images: JSON.stringify(item.images?.length ? item.images : [PLACEHOLDER_IMAGE]),
          price: item.price,
          originalPrice,
          discountPercent: discountPercent(item.price, originalPrice),
          rating: 0,
          reviewCount: 0,
          availability: item.availability || "unknown",
          isFlashDeal: discountPercent(item.price, originalPrice) >= 10,
          lastUpdated: new Date(item.checkedAt),
          specifications: JSON.stringify({
            needsEnrichment: false,
            storefrontBlocked: false,
            intakeSource: "owner-asin",
            metadataSource: "amazon-creators-api",
            metadataCheckedAt: item.checkedAt,
            priceSource: "amazon-creators-api",
            priceCheckedAt: item.checkedAt,
          }),
        },
      });
    } else {
      created = await prisma.product.create({
        data: {
          ...base,
          title: `Amazon listing ${asin}`,
          description: "Owner-added ASIN awaiting approved retailer metadata.",
          brand: "Amazon",
          images: JSON.stringify([PLACEHOLDER_IMAGE]),
          price: 0,
          originalPrice: 0,
          discountPercent: 0,
          rating: 0,
          reviewCount: 0,
          availability: "unknown",
          lastUpdated: new Date(0),
          specifications: JSON.stringify({
            needsEnrichment: true,
            storefrontBlocked: false,
            intakeSource: "owner-asin",
            queuedAt: now.toISOString(),
            priceSource: "unverified",
          }),
        },
      });
    }
  } catch (error) {
    const raced = await prisma.product.findFirst({ where: { retailer: "amazon", asin } });
    if (!raced) throw error;
    return {
      asin,
      status: "exists",
      productId: raced.id,
      usedApprovedApi: false,
      message: "That ASIN was already added.",
    };
  }

  await clearCatalogCaches();
  await prisma.importJob.create({
    data: {
      provider: "amazon-owner-asin",
      status: item ? "success" : "pending",
      itemsTotal: 1,
      itemsSuccess: item ? 1 : 0,
      itemsFailed: 0,
      errorLog: "[]",
      startedAt: now,
      finishedAt: item ? new Date() : null,
    },
  });
  await prisma.systemLog.create({
    data: {
      level: "info",
      source: "owner-intake",
      message: item
        ? `Owner published Amazon ASIN ${asin} with approved data`
        : `Owner queued Amazon ASIN ${asin} for approved enrichment`,
    },
  });

  return {
    asin,
    status: item ? "published" : "queued",
    productId: created.id,
    usedApprovedApi: Boolean(item),
    message: item
      ? "ASIN added and published with approved Amazon product data."
      : "ASIN added to your private queue. It stays off the storefront until approved retailer data is available.",
  };
}

export async function refreshOwnerIntakeQueue(limit = 10) {
  const safeLimit = Math.min(10, Math.max(1, Math.trunc(limit)));
  if (!amazonCreatorsConfigured()) {
    return { status: "skipped-unconfigured" as const, queued: 0, updated: 0 };
  }

  const queued = await prisma.product.findMany({
    where: {
      retailer: "amazon",
      asin: { not: null },
      specifications: { contains: '"needsEnrichment":true' },
    },
    orderBy: { createdAt: "asc" },
    take: safeLimit,
    select: { id: true, asin: true },
  });
  if (!queued.length) return { status: "empty" as const, queued: 0, updated: 0 };

  const items = await getAmazonCreatorItems(queued.flatMap((row) => (row.asin ? [row.asin] : [])));
  const byAsin = new Map(items.map((item) => [item.asin, item]));
  let updated = 0;

  for (const row of queued) {
    if (!row.asin) continue;
    const item = byAsin.get(row.asin.toUpperCase());
    if (!item) continue;
    await applyApprovedItem(row.id, item);
    updated += 1;
  }

  return { status: "attempted" as const, queued: queued.length, updated };
}
