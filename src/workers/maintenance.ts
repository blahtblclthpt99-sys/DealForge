import { prisma } from "../lib/db";
import { parseJson } from "../lib/utils";
import {
  amazonCreatorsConfigured,
  getAmazonCreatorItems,
} from "../lib/affiliate/amazon-creators";
import { buildAmazonProductUrl } from "../lib/affiliate/amazon-config";

type PriceAlert = {
  id: string;
  productId: string;
  targetPrice: number;
};

type PriceRefreshStatus =
  | "disabled"
  | "skipped-unconfigured"
  | "no-stale-products"
  | "attempted";

export type MaintenanceOptions = {
  priceRefreshLimit?: number;
  refreshTrending?: boolean;
  expireFlashDeals?: boolean;
  cleanCache?: boolean;
  processPriceAlerts?: boolean;
};

export type MaintenanceResult = {
  priceUpdates: number;
  priceRefreshStatus: PriceRefreshStatus;
  priceAlertHits: number;
  trendingProducts: number;
  expiredFlashDeals: number;
  purgedCacheEntries: number;
};

const MAX_ALERTS_PER_RUN = 2_000;
const AMAZON_PRICE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PRICE_REFRESH_PER_RUN = 50;

function isFreshTrustedAmazonPrice(product: {
  retailer: string;
  lastUpdated: Date;
  specifications: string;
}) {
  if (product.retailer.trim().toLowerCase() !== "amazon") return true;
  const specs = parseJson<Record<string, string>>(product.specifications, {});
  return (
    specs.priceSource === "amazon-creators-api" &&
    Date.now() - product.lastUpdated.getTime() <= AMAZON_PRICE_TTL_MS
  );
}

async function refreshTrending() {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      clickCount: true,
      viewCount: true,
      discountPercent: true,
      lastUpdated: true,
      retailer: true,
      specifications: true,
    },
  });

  const updates: Array<ReturnType<typeof prisma.product.update>> = [];
  for (const product of products) {
    const ctr = product.viewCount > 0 ? product.clickCount / product.viewCount : 0;
    const ageDays =
      (Date.now() - product.lastUpdated.getTime()) / (1000 * 60 * 60 * 24);
    const freshness = Math.max(0, 1 - ageDays / 30);
    const trustedDiscount = isFreshTrustedAmazonPrice(product)
      ? product.discountPercent
      : 0;
    const score =
      Math.round((ctr * 40 + trustedDiscount * 0.4 + freshness * 30) * 10) / 10;
    updates.push(
      prisma.product.update({
        where: { id: product.id },
        data: { trendingScore: score },
      }),
    );

    if (updates.length >= 100) {
      await prisma.$transaction(updates.splice(0, updates.length));
    }
  }
  if (updates.length) await prisma.$transaction(updates);

  await prisma.systemLog.create({
    data: {
      level: "info",
      source: "worker",
      message: `Refreshed trending for ${products.length} products`,
    },
  });
  return products.length;
}

async function expireFlashDeals() {
  const result = await prisma.product.updateMany({
    where: { isFlashDeal: true, flashEndsAt: { lt: new Date() } },
    data: { isFlashDeal: false },
  });
  if (result.count) {
    await prisma.systemLog.create({
      data: {
        level: "info",
        source: "worker",
        message: `Expired ${result.count} flash deals`,
      },
    });
  }
  return result.count;
}

async function cleanCache() {
  const result = await prisma.cacheEntry.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  if (result.count) {
    await prisma.systemLog.create({
      data: {
        level: "info",
        source: "worker",
        message: `Purged ${result.count} cache entries`,
      },
    });
  }
  return result.count;
}

async function processPriceAlerts() {
  const users = await prisma.user.findMany({ select: { id: true, priceAlerts: true } });
  const alertRows: Array<{ userId: string; alert: PriceAlert }> = [];

  for (const user of users) {
    const alerts = parseJson<PriceAlert[]>(user.priceAlerts, []);
    for (const alert of alerts) {
      if (
        alertRows.length >= MAX_ALERTS_PER_RUN ||
        !alert?.productId ||
        !Number.isFinite(alert.targetPrice) ||
        alert.targetPrice <= 0
      ) {
        continue;
      }
      alertRows.push({ userId: user.id, alert });
    }
  }

  if (!alertRows.length) return 0;

  const productIds = Array.from(new Set(alertRows.map((row) => row.alert.productId)));
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      price: true,
      retailer: true,
      lastUpdated: true,
      specifications: true,
    },
  });
  const byId = new Map(products.map((product) => [product.id, product]));

  let hits = 0;
  for (const { userId, alert } of alertRows) {
    const product = byId.get(alert.productId);
    if (
      product &&
      isFreshTrustedAmazonPrice(product) &&
      product.price <= alert.targetPrice
    ) {
      hits += 1;
      await prisma.systemLog.create({
        data: {
          level: "info",
          source: "price-alert",
          message: `Price threshold reached for product ${product.id}`,
          meta: JSON.stringify({ userId, productId: product.id, price: product.price }),
        },
      });
    }
  }
  return hits;
}

/**
 * Refresh a bounded batch of stale Amazon listings using the approved Creators API.
 * High-engagement and featured products are refreshed first so a large catalog
 * spends limited API capacity on listings users are most likely to see/click.
 * Failed or unconfigured refreshes never touch lastUpdated, so stale prices do
 * not become publishable by accident.
 */
async function refreshPrices(
  limit = 20,
): Promise<{ updated: number; status: PriceRefreshStatus }> {
  if (!amazonCreatorsConfigured()) {
    // Readiness is surfaced through the admin/runtime status. Do not write the
    // same warning to SystemLog every five minutes while credentials are absent.
    return { updated: 0, status: "skipped-unconfigured" };
  }

  const safeLimit = Math.min(
    MAX_PRICE_REFRESH_PER_RUN,
    Math.max(1, Math.trunc(limit)),
  );
  const cutoff = new Date(Date.now() - AMAZON_PRICE_TTL_MS);
  const rows = await prisma.product.findMany({
    where: {
      retailer: "amazon",
      asin: { not: null },
      lastUpdated: { lt: cutoff },
    },
    orderBy: [
      { isFeatured: "desc" },
      { clickCount: "desc" },
      { viewCount: "desc" },
      { lastUpdated: "asc" },
    ],
    take: safeLimit,
    select: {
      id: true,
      asin: true,
      title: true,
      images: true,
      specifications: true,
    },
  });

  if (!rows.length) return { updated: 0, status: "no-stale-products" };

  let updated = 0;
  for (let offset = 0; offset < rows.length; offset += 10) {
    const batch = rows.slice(offset, offset + 10);
    const items = await getAmazonCreatorItems(
      batch.flatMap((row) => (row.asin ? [row.asin] : [])),
    );
    const byAsin = new Map(items.map((item) => [item.asin, item]));

    const writes = batch.flatMap((row) => {
      if (!row.asin) return [];
      const item = byAsin.get(row.asin.toUpperCase());
      if (!item || !(item.price > 0)) return [];

      const originalPrice = Math.max(item.originalPrice || item.price, item.price);
      const discountPercent =
        originalPrice > item.price
          ? Math.round(((originalPrice - item.price) / originalPrice) * 1000) / 10
          : 0;
      const specs = parseJson<Record<string, string>>(row.specifications, {});
      const images = item.images?.length ? JSON.stringify(item.images) : row.images;

      updated += 1;
      return [
        prisma.product.update({
          where: { id: row.id },
          data: {
            title: item.title || row.title,
            description: item.description || item.title || row.title,
            brand: item.brand || undefined,
            images,
            price: item.price,
            originalPrice,
            discountPercent,
            affiliateUrl: buildAmazonProductUrl(row.asin),
            availability: item.availability || "unknown",
            isFlashDeal: discountPercent >= 10,
            lastUpdated: new Date(item.checkedAt),
            specifications: JSON.stringify({
              ...specs,
              priceSource: "amazon-creators-api",
              priceCheckedAt: item.checkedAt,
            }),
          },
        }),
      ];
    });

    if (writes.length) await prisma.$transaction(writes);
  }

  await prisma.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });
  await prisma.systemLog.create({
    data: {
      level: "info",
      source: "worker",
      message: `Creators API price refresh: ${updated}/${rows.length} updated`,
    },
  });
  return { updated, status: "attempted" };
}

export async function runMaintenanceOnce(
  options: MaintenanceOptions = {},
): Promise<MaintenanceResult> {
  const {
    priceRefreshLimit = 20,
    refreshTrending: shouldRefreshTrending = true,
    expireFlashDeals: shouldExpireFlashDeals = true,
    cleanCache: shouldCleanCache = true,
    processPriceAlerts: shouldProcessPriceAlerts = true,
  } = options;

  const priceRefresh =
    priceRefreshLimit > 0
      ? await refreshPrices(priceRefreshLimit)
      : { updated: 0, status: "disabled" as const };
  const trendingProducts = shouldRefreshTrending ? await refreshTrending() : 0;
  const expiredFlashDeals = shouldExpireFlashDeals ? await expireFlashDeals() : 0;
  const purgedCacheEntries = shouldCleanCache ? await cleanCache() : 0;
  const priceAlertHits = shouldProcessPriceAlerts ? await processPriceAlerts() : 0;

  return {
    priceUpdates: priceRefresh.updated,
    priceRefreshStatus: priceRefresh.status,
    priceAlertHits,
    trendingProducts,
    expiredFlashDeals,
    purgedCacheEntries,
  };
}
