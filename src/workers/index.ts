/**
 * Background worker for DealForge:
 * - refreshes trending scores
 * - expires flash deals
 * - cleans cache entries
 * - checks price alerts only against trusted fresh prices
 * - refreshes stale Amazon products through Amazon Creators API
 *
 * Run: npm run worker
 * Once: npm run worker -- --once
 */

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

const WORKER_INTERVAL_MS = 5 * 60 * 1000;
const MAX_ALERTS_PER_RUN = 2_000;
const AMAZON_PRICE_TTL_MS = 24 * 60 * 60 * 1000;

function isFreshTrustedAmazonPrice(product: {
  retailer: string;
  lastUpdated: Date;
  specifications: string;
}) {
  if (product.retailer !== "amazon") return true;
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
  for (const p of products) {
    const ctr = p.viewCount > 0 ? p.clickCount / p.viewCount : 0;
    const ageDays = (Date.now() - p.lastUpdated.getTime()) / (1000 * 60 * 60 * 24);
    const freshness = Math.max(0, 1 - ageDays / 30);
    const trustedDiscount = isFreshTrustedAmazonPrice(p) ? p.discountPercent : 0;
    const score = Math.round((ctr * 40 + trustedDiscount * 0.4 + freshness * 30) * 10) / 10;
    updates.push(prisma.product.update({ where: { id: p.id }, data: { trendingScore: score } }));

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
}

async function expireFlashDeals() {
  const result = await prisma.product.updateMany({
    where: { isFlashDeal: true, flashEndsAt: { lt: new Date() } },
    data: { isFlashDeal: false },
  });
  if (result.count) {
    await prisma.systemLog.create({
      data: { level: "info", source: "worker", message: `Expired ${result.count} flash deals` },
    });
  }
}

async function cleanCache() {
  const result = await prisma.cacheEntry.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  await prisma.systemLog.create({
    data: { level: "info", source: "worker", message: `Purged ${result.count} cache entries` },
  });
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
      title: true,
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
 * Refresh a bounded batch of Amazon listings using the approved Creators API.
 * If credentials are unavailable, no product timestamp is touched: an old price
 * must never become "fresh" just because a refresh attempt failed.
 */
async function refreshPrices(limit = 20) {
  if (!amazonCreatorsConfigured()) {
    await prisma.systemLog.create({
      data: {
        level: "warn",
        source: "worker",
        message: "Amazon price refresh skipped: Creators API credentials are not configured",
      },
    });
    return 0;
  }

  const safeLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
  const cutoff = new Date(Date.now() - AMAZON_PRICE_TTL_MS);
  const rows = await prisma.product.findMany({
    where: {
      retailer: "amazon",
      asin: { not: null },
      lastUpdated: { lt: cutoff },
    },
    orderBy: { lastUpdated: "asc" },
    take: safeLimit,
    select: {
      id: true,
      asin: true,
      title: true,
      images: true,
      specifications: true,
    },
  });

  let updated = 0;
  for (let offset = 0; offset < rows.length; offset += 10) {
    const batch = rows.slice(offset, offset + 10);
    const items = await getAmazonCreatorItems(batch.flatMap((row) => (row.asin ? [row.asin] : [])));
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

  if (rows.length) {
    await prisma.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });
    await prisma.systemLog.create({
      data: {
        level: "info",
        source: "worker",
        message: `Creators API price refresh: ${updated}/${rows.length} updated`,
      },
    });
  }
  return updated;
}

async function runOnce() {
  console.log(`[worker] starting ${new Date().toISOString()}`);
  const priceUpdates = await refreshPrices(20);
  await refreshTrending();
  await expireFlashDeals();
  await cleanCache();
  const alerts = await processPriceAlerts();
  console.log(`[worker] done — ${priceUpdates} prices, ${alerts} price alert hits`);
}

const once = process.argv.includes("--once");
let running = false;

async function guardedRun() {
  if (running) {
    console.warn("[worker] previous cycle still running; skipping overlapping cycle");
    return;
  }
  running = true;
  try {
    await runOnce();
  } finally {
    running = false;
  }
}

guardedRun()
  .then(() => {
    if (once) process.exit(0);
    setInterval(() => {
      guardedRun().catch(console.error);
    }, WORKER_INTERVAL_MS);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
