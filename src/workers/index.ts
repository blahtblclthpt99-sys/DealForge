/**
 * DealForge maintenance worker.
 *
 * This worker intentionally DOES NOT scrape Amazon product pages. Amazon
 * pricing/ratings/availability are only considered current when supplied by
 * an authorized source. Product Engine processing is handled separately.
 *
 * Run: npm run worker
 * Once: npm run worker -- --once
 */

import { prisma } from "../lib/db";
import { parseJson } from "../lib/utils";
import { runProductEngine } from "../lib/product-engine";
import { pauseUnsafeCommerceProducts } from "../lib/commerce-monitor";

type PriceAlert = { id: string; productId: string; targetPrice: number };

async function refreshTrending() {
  const products = await prisma.product.findMany({
    select: { id: true, clickCount: true, viewCount: true, discountPercent: true, lastUpdated: true },
  });
  for (const p of products) {
    const ctr = p.viewCount > 0 ? p.clickCount / p.viewCount : 0;
    const ageDays = (Date.now() - p.lastUpdated.getTime()) / 86400000;
    const freshness = Math.max(0, 1 - ageDays / 30);
    const score = Math.round((ctr * 40 + p.discountPercent * 0.4 + freshness * 30) * 10) / 10;
    await prisma.product.update({ where: { id: p.id }, data: { trendingScore: score } });
  }
  await prisma.systemLog.create({ data: { level: "info", source: "worker", message: `Refreshed trending for ${products.length} products` } });
}

async function expireFlashDeals() {
  const result = await prisma.product.updateMany({ where: { isFlashDeal: true, flashEndsAt: { lt: new Date() } }, data: { isFlashDeal: false } });
  if (result.count) await prisma.systemLog.create({ data: { level: "info", source: "worker", message: `Expired ${result.count} flash deals` } });
}

async function cleanCache() {
  const result = await prisma.cacheEntry.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.systemLog.create({ data: { level: "info", source: "worker", message: `Purged ${result.count} cache entries` } });
}

function amazonPriceIsAuthoritative(product: { retailer: string; priceSource: string | null; priceVerifiedAt: Date | null }) {
  if (product.retailer !== "amazon") return true;
  if (!product.priceSource || !product.priceVerifiedAt) return false;
  const allowed = new Set(["amazon_creators_api", "amazon_authorized_api", "amazon_owner_verified"]);
  return allowed.has(product.priceSource) && Date.now() - product.priceVerifiedAt.getTime() <= 24 * 60 * 60 * 1000;
}

async function processPriceAlerts() {
  const users = await prisma.user.findMany();
  let hits = 0;
  for (const user of users) {
    const alerts = parseJson<PriceAlert[]>(user.priceAlerts, []);
    for (const alert of alerts) {
      const product = await prisma.product.findUnique({
        where: { id: alert.productId },
        select: { id: true, title: true, price: true, retailer: true, priceSource: true, priceVerifiedAt: true },
      });
      if (!product || !amazonPriceIsAuthoritative(product)) continue;
      if (product.price > 0 && product.price <= alert.targetPrice) {
        hits += 1;
        await prisma.systemLog.create({
          data: {
            level: "info",
            source: "price-alert",
            message: `Verified price threshold reached for product ${product.id}`,
            meta: JSON.stringify({ userId: user.id, productId: product.id, price: product.price, priceSource: product.priceSource }),
          },
        });
      }
    }
  }
  return hits;
}

async function runOnce() {
  console.log(`[worker] starting ${new Date().toISOString()}`);
  await refreshTrending();
  await expireFlashDeals();
  await cleanCache();
  const commerce = await pauseUnsafeCommerceProducts("maintenance-worker");
  const engine = await runProductEngine("maintenance-worker");
  const alerts = await processPriceAlerts();
  console.log(`[worker] done — commerce checked ${commerce.checked}, paused ${commerce.paused}; product-engine ${engine.processed} candidates; ${alerts} verified price-alert hits`);
}

const once = process.argv.includes("--once");
runOnce()
  .then(() => {
    if (once) process.exit(0);
    setInterval(() => runOnce().catch(console.error), 5 * 60 * 1000);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });