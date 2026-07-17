/**
 * Fix absurd DealForge prices (e.g. $6 / $2014 = 100% off).
 * - Caps bogus list prices
 * - Re-scrapes Amazon for high-discount / extreme ratio products
 * - Falls back to price=originalPrice (0% off) when scrape fails
 *
 * Usage:
 *   npx tsx scripts/fix-absurd-prices.ts
 *   npx tsx scripts/fix-absurd-prices.ts --limit 200
 *   npx tsx scripts/fix-absurd-prices.ts --dry-run
 */
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 500;
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Max realistic sale discount we trust without live confirmation */
const MAX_TRUSTED_DISCOUNT = 70;
/** List price more than this multiple of sale price is almost always scrape garbage */
const MAX_LIST_RATIO = 2.5;

function extractPrice(html: string) {
  const patterns = [
    /"priceAmount":\s*([0-9]+(?:\.[0-9]+)?)/,
    /class="a-offscreen">\$([0-9,]+\.?[0-9]*)</,
    /"displayPrice":"\$([0-9,]+\.?[0-9]*)"/,
    /data-a-color="price"[^>]*>\s*<span[^>]*>\$([0-9,]+\.?[0-9]*)</,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      const v = parseFloat(m[1].replace(/,/g, ""));
      // Reject obviously wrong scrapes (e.g. years, review counts)
      if (v >= 0.5 && v < 5000) return v;
    }
  }
  return null;
}

function extractList(html: string, price: number) {
  const patterns = [
    /List Price[^$]{0,40}\$([0-9,]+\.?[0-9]*)/i,
    /"listPrice"[^0-9]{0,20}([0-9]+(?:\.[0-9]+)?)/i,
    /Was:\s*\$([0-9,]+\.?[0-9]*)/i,
    /Typical price:\s*\$([0-9,]+\.?[0-9]*)/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (!m?.[1]) continue;
    const v = parseFloat(m[1].replace(/,/g, ""));
    if (!(v > price)) continue;
    if (v > price * MAX_LIST_RATIO) continue;
    if (v >= 5000) continue;
    return v;
  }
  return price;
}

function calcDiscount(price: number, originalPrice: number) {
  if (!originalPrice || originalPrice <= price) return 0;
  return Math.round(((originalPrice - price) / originalPrice) * 1000) / 10;
}

function isAbsurd(price: number, originalPrice: number, discountPercent: number) {
  if (price <= 0) return true;
  if (discountPercent >= MAX_TRUSTED_DISCOUNT) return true;
  if (originalPrice > price * MAX_LIST_RATIO) return true;
  if (originalPrice >= 500 && discountPercent >= 50) return true;
  if (price < 1 && originalPrice > 10) return true;
  return false;
}

async function scrape(asin: string) {
  const urls = [
    `https://www.amazon.com/gp/aw/d/${asin}`,
    `https://www.amazon.com/dp/${asin}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
        redirect: "follow",
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (/captcha|robot check|automated access/i.test(html.slice(0, 4000))) continue;
      if (/page not found|currently unavailable\.?\s*we don't know when/i.test(html)) {
        return { dead: true as const };
      }
      const price = extractPrice(html);
      if (!price) continue;
      const originalPrice = extractList(html, price);
      return { dead: false as const, price, originalPrice };
    } catch {
      continue;
    }
  }
  return null;
}

async function main() {
  // Always include the reported ASIN
  const forced = await prisma.product.findMany({
    where: { asin: "B0CKZ4ZWYG" },
    select: {
      id: true,
      asin: true,
      title: true,
      price: true,
      originalPrice: true,
      discountPercent: true,
    },
  });

  const suspects = await prisma.product.findMany({
    where: {
      retailer: "amazon",
      asin: { not: null },
      OR: [
        { discountPercent: { gte: MAX_TRUSTED_DISCOUNT } },
        { price: { lte: 1 } },
        {
          AND: [{ originalPrice: { gt: 100 } }, { discountPercent: { gte: 50 } }],
        },
      ],
    },
    select: {
      id: true,
      asin: true,
      title: true,
      price: true,
      originalPrice: true,
      discountPercent: true,
    },
    orderBy: { discountPercent: "desc" },
    take: LIMIT,
  });

  const byId = new Map<string, (typeof suspects)[0]>();
  for (const r of [...forced, ...suspects]) byId.set(r.id, r);
  const list = [...byId.values()].filter((r) =>
    isAbsurd(r.price, r.originalPrice, r.discountPercent),
  );

  console.log(`Fixing ${list.length} absurd-priced products…${DRY ? " [dry-run]" : ""}`);

  let scrapedOk = 0;
  let zeroed = 0;
  let removed = 0;
  let failed = 0;

  for (const row of list) {
    const asin = row.asin!;
    await sleep(900 + Math.random() * 700);
    const result = await scrape(asin);

    if (result?.dead) {
      console.log(`DEAD  ${asin}  removing  ${row.title.slice(0, 50)}`);
      if (!DRY) {
        await prisma.product.delete({ where: { id: row.id } });
      }
      removed++;
      continue;
    }

    if (result && result.price > 0) {
      const originalPrice = Math.max(result.originalPrice, result.price);
      const discountPercent = calcDiscount(result.price, originalPrice);
      console.log(
        `FIX   ${asin}  $${row.price}/$${row.originalPrice} (${row.discountPercent}%) → $${result.price}/$${originalPrice} (${discountPercent}%)  ${row.title.slice(0, 40)}`,
      );
      if (!DRY) {
        await prisma.product.update({
          where: { id: row.id },
          data: {
            price: result.price,
            originalPrice,
            discountPercent,
            lastUpdated: new Date(),
          },
        });
      }
      scrapedOk++;
      continue;
    }

    // Scrape failed — neutralize fake discount rather than leave 100% off
    console.log(
      `ZERO  ${asin}  $${row.price}/$${row.originalPrice} → $${row.price}/$${row.price} (0%)  ${row.title.slice(0, 40)}`,
    );
    if (!DRY) {
      await prisma.product.update({
        where: { id: row.id },
        data: {
          originalPrice: row.price,
          discountPercent: 0,
          lastUpdated: new Date(),
        },
      });
    }
    zeroed++;
    failed++;
  }

  // Safety pass: any remaining discount >= 80% get neutralized without scrape
  if (!DRY) {
    const remaining = await prisma.product.findMany({
      where: { discountPercent: { gte: 80 } },
      select: { id: true, price: true, asin: true, title: true, discountPercent: true },
    });
    for (const row of remaining) {
      await prisma.product.update({
        where: { id: row.id },
        data: { originalPrice: row.price, discountPercent: 0 },
      });
      console.log(`SAFE  ${row.asin}  cleared ${row.discountPercent}% off`);
      zeroed++;
    }
  }

  await prisma.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });

  console.log("\n=== Results ===");
  console.log({ scrapedOk, zeroed, removed, failed });
  const stillBad = await prisma.product.count({ where: { discountPercent: { gte: 80 } } });
  console.log(`remaining discount>=80%: ${stillBad}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
