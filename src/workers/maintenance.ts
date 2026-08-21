import { prisma } from "../lib/db";
import { publicProductWhere } from "../lib/product-visibility";
import { mutateUserJsonState } from "../lib/user-json-state";
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
  createdAt?: string;
  triggered?: boolean;
  lastTriggeredAt?: string | null;
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
const MAX_ALERTS_PER_USER = 50;
const AMAZON_PRICE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PRICE_REFRESH_PER_RUN = 50;

function cleanPriceAlerts(value: unknown): PriceAlert[] {
  if (!Array.isArray(value)) return [];
  const cleaned: PriceAlert[] = [];
  const seenProducts = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<PriceAlert>;
    const id = typeof candidate.id === "string" ? candidate.id.trim().slice(0, 100) : "";
    const productId =
      typeof candidate.productId === "string" ? candidate.productId.trim().slice(0, 100) : "";
    const targetPrice = Number(candidate.targetPrice);
    if (
      !id ||
      !productId ||
      seenProducts.has(productId) ||
      !Number.isFinite(targetPrice) ||
      targetPrice <= 0 ||
      targetPrice > 1_000_000
    ) {
      continue;
    }

    seenProducts.add(productId);
    cleaned.push({
      id,
      productId,
      targetPrice: Math.round(targetPrice * 100) / 100,
      createdAt:
        typeof candidate.createdAt === "string"
          ? candidate.createdAt.slice(0, 64)
          : new Date(0).toISOString(),
      triggered: candidate.triggered === true,
      lastTriggeredAt:
        typeof candidate.lastTriggeredAt === "string"
          ? candidate.lastTriggeredAt.slice(0, 64)
          : null,
    });

    if (cleaned.length >= MAX_ALERTS_PER_USER) break;
  }

  return cleaned;
}

function trustedPriceTimestamp(specifications: string, lastUpdated: Date) {
  const specs = parseJson<Record<string, string>>(specifications, {});
  const checkedAt = Date.parse(specs.priceCheckedAt || "");
  return Number.isFinite(checkedAt) ? checkedAt : lastUpdated.getTime();
}

function isFreshTrustedAmazonPrice(product: {
  retailer: string;
  lastUpdated: Date;
  specifications: string;
}) {
  if (product.retailer.trim().toLowerCase() !== "amazon") return true;
  const specs = parseJson<Record<string, string>>(product.specifications, {});
  return (
    specs.priceSource === "amazon-creators-api" &&
    Date.now() - trustedPriceTimestamp(product.specifications, product.lastUpdated) <=
      AMAZON_PRICE_TTL_MS
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
  const productIds = new Set<string>();
  let observedAlerts = 0;

  for (const user of users) {
    for (const alert of cleanPriceAlerts(parseJson<unknown>(user.priceAlerts, []))) {
      if (observedAlerts >= MAX_ALERTS_PER_RUN) break;
      productIds.add(alert.productId);
      observedAlerts += 1;
    }
    if (observedAlerts >= MAX_ALERTS_PER_RUN) break;
  }

  if (!productIds.size) return 0;

  const products = await prisma.product.findMany({
    where: publicProductWhere({ id: { in: [...productIds] } }),
    select: {
      id: true,
      price: true,
      retailer: true,
      lastUpdated: true,
      specifications: true,
    },
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  const transitionTime = new Date().toISOString();
  let hits = 0;

  for (const user of users) {
    const result = await mutateUserJsonState<unknown>(
      user.id,
      "priceAlerts",
      [],
      (current) =>
        cleanPriceAlerts(current).map((alert) => {
          const product = byId.get(alert.productId);
          if (!product || !isFreshTrustedAmazonPrice(product) || !(product.price > 0)) {
            // Unknown/stale prices cannot satisfy an alert, but they also must
            // not reset an already-triggered edge. Reset only after a fresh,
            // trusted price is observed above the target.
            return alert;
          }

          const satisfied = product.price <= alert.targetPrice;
          if (satisfied && !alert.triggered) {
            return { ...alert, triggered: true, lastTriggeredAt: transitionTime };
          }
          if (!satisfied && alert.triggered) {
            return { ...alert, triggered: false };
          }
          return alert;
        }),
    );

    if (result.status !== "ok" || !result.changed) continue;

    const previousById = new Map(
      cleanPriceAlerts(result.previous).map((alert) => [alert.id, alert]),
    );
    for (const alert of cleanPriceAlerts(result.value)) {
      const previous = previousById.get(alert.id);
      if (!alert.triggered || previous?.triggered) continue;

      const product = byId.get(alert.productId);
      if (!product || !isFreshTrustedAmazonPrice(product) || !(product.price > 0)) continue;

      hits += 1;
      await prisma.systemLog.create({
        data: {
          level: "info",
          source: "price-alert",
          message: `Price threshold reached for product ${product.id}`,
          meta: JSON.stringify({
            userId: user.id,
            productId: product.id,
            price: product.price,
            targetPrice: alert.targetPrice,
            triggeredAt: alert.lastTriggeredAt,
          }),
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
