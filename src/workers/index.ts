/**
 * Background worker for DealForge:
 * - refreshes trending scores
 * - expires flash deals
 * - cleans cache entries
 * - checks price alerts
 * - refreshes stale Amazon prices (keeps catalog current)
 *
 * Run: npm run worker
 * Once: npm run worker -- --once
 *
 * This process is intentionally separate from the Koyeb web service. Do not
 * start it from the production web command on the free hosting allocation.
 */

import { prisma } from "../lib/db";
import { parseJson } from "../lib/utils";

type PriceAlert = {
  id: string;
  productId: string;
  targetPrice: number;
};

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const WORKER_INTERVAL_MS = 5 * 60 * 1000;
const AMAZON_FETCH_TIMEOUT_MS = 10_000;
const MAX_ALERTS_PER_RUN = 2_000;

function extractPrice(html: string) {
  const patterns = [
    /"priceAmount":\s*([0-9]+(?:\.[0-9]+)?)/,
    /class="a-offscreen">\$([0-9,]+\.?[0-9]*)</,
    /"displayPrice":"\$([0-9,]+\.?[0-9]*)"/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      const v = parseFloat(m[1].replace(/,/g, ""));
      if (v > 0 && v < 10000) return v;
    }
  }
  return null;
}

function extractList(html: string, price: number) {
  const m = html.match(/List Price[^$]{0,40}\$([0-9,]+\.?[0-9]*)/i);
  if (m?.[1]) {
    const v = parseFloat(m[1].replace(/,/g, ""));
    if (v > price && v <= price * 2.5 && v < 5000) return v;
  }
  return price;
}

async function scrapePrice(asin: string) {
  try {
    const res = await fetch(`https://www.amazon.com/gp/aw/d/${asin}`, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(AMAZON_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (/captcha|robot check|automated access/i.test(html.slice(0, 4000))) return null;
    const price = extractPrice(html);
    if (!price) return null;
    return { price, originalPrice: extractList(html, price) };
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function refreshTrending() {
  const products = await prisma.product.findMany({
    select: { id: true, clickCount: true, viewCount: true, discountPercent: true, lastUpdated: true },
  });

  const updates: Array<ReturnType<typeof prisma.product.update>> = [];
  for (const p of products) {
    const ctr = p.viewCount > 0 ? p.clickCount / p.viewCount : 0;
    const ageDays = (Date.now() - p.lastUpdated.getTime()) / (1000 * 60 * 60 * 24);
    const freshness = Math.max(0, 1 - ageDays / 30);
    const score = Math.round((ctr * 40 + p.discountPercent * 0.4 + freshness * 30) * 10) / 10;
    updates.push(prisma.product.update({ where: { id: p.id }, data: { trendingScore: score } }));

    if (updates.length >= 100) {
      await prisma.$transaction(updates.splice(0, updates.length));
    }
  }
  if (updates.length) await prisma.$transaction(updates);

  await prisma.systemLog.create({
    data: { level: "info", source: "worker", message: `Refreshed trending for ${products.length} products` },
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
    select: { id: true, title: true, price: true },
  });
  const byId = new Map(products.map((product) => [product.id, product]));

  let hits = 0;
  for (const { userId, alert } of alertRows) {
    const product = byId.get(alert.productId);
    if (product && product.price <= alert.targetPrice) {
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

/** Keep prices current — scrapes a small batch of stale Amazon listings each cycle. */
async function refreshPrices(limit = 15) {
  const safeLimit = Math.min(25, Math.max(1, Math.trunc(limit)));
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.product.findMany({
    where: {
      retailer: "amazon",
      asin: { not: null },
      lastUpdated: { lt: cutoff },
    },
    orderBy: { lastUpdated: "asc" },
    take: safeLimit,
    select: { id: true, asin: true, price: true },
  });

  let updated = 0;
  for (const row of rows) {
    if (!row.asin) continue;
    const scraped = await scrapePrice(row.asin);
    if (!scraped) {
      await prisma.product.update({
        where: { id: row.id },
        data: { lastUpdated: new Date() },
      });
      await sleep(1200);
      continue;
    }
    const discountPercent =
      scraped.originalPrice > scraped.price
        ? Math.round(
            ((scraped.originalPrice - scraped.price) / scraped.originalPrice) * 1000,
          ) / 10
        : 0;
    await prisma.product.update({
      where: { id: row.id },
      data: {
        price: scraped.price,
        originalPrice: Math.max(scraped.originalPrice, scraped.price),
        discountPercent,
        lastUpdated: new Date(),
      },
    });
    updated += 1;
    await sleep(1800);
  }

  if (rows.length) {
    await prisma.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });
    await prisma.systemLog.create({
      data: {
        level: "info",
        source: "worker",
        message: `Price refresh: ${updated}/${rows.length} updated`,
      },
    });
  }
  return updated;
}

async function runOnce() {
  console.log(`[worker] starting ${new Date().toISOString()}`);
  await refreshTrending();
  await expireFlashDeals();
  await cleanCache();
  const priceUpdates = await refreshPrices(15);
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
