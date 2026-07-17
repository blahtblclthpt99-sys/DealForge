/**
 * Refresh Amazon prices for products that are stale.
 * Usage:
 *   npx tsx scripts/refresh-prices.ts
 *   npx tsx scripts/refresh-prices.ts --limit 50
 *   npx tsx scripts/refresh-prices.ts --stale-hours 12
 */
import { PrismaClient } from "@prisma/client";

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function argNum(flag: string, fallback: number) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) {
    const n = Number(process.argv[i + 1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

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
  const m = html.match(/List Price[^$]*\$([0-9,]+\.?[0-9]*)/i);
  if (m?.[1]) {
    const v = parseFloat(m[1].replace(/,/g, ""));
    if (v > price) return v;
  }
  return price;
}

async function scrapePrice(asin: string) {
  const url = `https://www.amazon.com/gp/aw/d/${asin}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
    redirect: "follow",
  });
  if (!res.ok) return null;
  const html = await res.text();
  if (/captcha|robot check|automated access/i.test(html.slice(0, 4000))) return null;
  const price = extractPrice(html);
  if (!price) return null;
  return { price, originalPrice: extractList(html, price) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function refreshStalePrices(options?: {
  limit?: number;
  staleHours?: number;
  silent?: boolean;
}) {
  const prisma = new PrismaClient();
  const limit = options?.limit ?? argNum("--limit", 40);
  const staleHours = options?.staleHours ?? argNum("--stale-hours", 24);
  const cutoff = new Date(Date.now() - staleHours * 60 * 60 * 1000);
  const log = options?.silent ? () => undefined : console.log;

  const rows = await prisma.product.findMany({
    where: {
      retailer: "amazon",
      asin: { not: null },
      lastUpdated: { lt: cutoff },
    },
    orderBy: { lastUpdated: "asc" },
    take: limit,
    select: { id: true, asin: true, title: true, price: true, originalPrice: true },
  });

  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.asin) continue;
    try {
      const scraped = await scrapePrice(row.asin);
      if (!scraped) {
        failed += 1;
        await prisma.product.update({
          where: { id: row.id },
          data: { lastUpdated: new Date() },
        });
        await sleep(1500);
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
      log(`OK  ${row.asin}  $${row.price} → $${scraped.price}  ${row.title.slice(0, 50)}`);
    } catch {
      failed += 1;
    }
    await sleep(2000);
  }

  await prisma.cacheEntry.deleteMany({
    where: { key: { startsWith: "products:" } },
  });

  await prisma.systemLog.create({
    data: {
      level: "info",
      source: "price-refresh",
      message: `Refreshed prices: ${updated} updated, ${failed} failed, ${rows.length} checked`,
    },
  });

  await prisma.$disconnect();
  return { updated, failed, checked: rows.length };
}

refreshStalePrices()
  .then((r) => {
    console.log("\n=== Price refresh ===");
    console.log(r);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
