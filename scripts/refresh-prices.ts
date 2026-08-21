/**
 * Refresh stale Amazon prices through Amazon Creators API only.
 *
 * Safety rules:
 * - never scrape Amazon HTML for price data
 * - never advance lastUpdated when a refresh fails
 * - never mark suspicious or missing values fresh
 * - only a successful Creators API response may set priceSource=amazon-creators-api
 *
 * Usage:
 *   npx tsx scripts/refresh-prices.ts
 *   npx tsx scripts/refresh-prices.ts --limit 50
 *   npx tsx scripts/refresh-prices.ts --stale-hours 24
 */
import { PrismaClient } from "@prisma/client";
import { getAmazonCreatorItems, amazonCreatorsConfigured } from "../src/lib/affiliate/amazon-creators";
import { buildAmazonProductUrl } from "../src/lib/affiliate/amazon-config";
import { parseJson } from "../src/lib/utils";

function argNum(flag: string, fallback: number) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) {
    const n = Number(process.argv[i + 1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

function sanePrice(current: number, next: number) {
  if (!Number.isFinite(next) || next <= 0 || next >= 100_000) return false;
  if (current <= 0) return true;
  if (current > 5 && next < current * 0.2) return false;
  if (next > current * 5 && next > 100) return false;
  return true;
}

export async function refreshStalePrices(options?: {
  limit?: number;
  staleHours?: number;
  silent?: boolean;
}) {
  if (!amazonCreatorsConfigured()) {
    throw new Error(
      "Amazon Creators API credentials are not configured. Set AMAZON_CREATORS_CREDENTIAL_ID and AMAZON_CREATORS_CREDENTIAL_SECRET before refreshing prices.",
    );
  }

  const prisma = new PrismaClient();
  const limit = Math.min(500, Math.max(1, options?.limit ?? argNum("--limit", 50)));
  const staleHours = Math.max(1, options?.staleHours ?? argNum("--stale-hours", 24));
  const cutoff = new Date(Date.now() - staleHours * 60 * 60 * 1000);
  const log = options?.silent ? () => undefined : console.log;

  try {
    const rows = await prisma.product.findMany({
      where: {
        retailer: "amazon",
        asin: { not: null },
        lastUpdated: { lt: cutoff },
      },
      orderBy: [{ clickCount: "desc" }, { viewCount: "desc" }, { lastUpdated: "asc" }],
      take: limit,
      select: {
        id: true,
        asin: true,
        title: true,
        price: true,
        images: true,
        specifications: true,
      },
    });

    let updated = 0;
    let missing = 0;
    let suspicious = 0;
    let errors = 0;

    for (let offset = 0; offset < rows.length; offset += 10) {
      const batch = rows.slice(offset, offset + 10);
      try {
        const items = await getAmazonCreatorItems(
          batch.flatMap((row) => (row.asin ? [row.asin] : [])),
        );
        const byAsin = new Map(items.map((item) => [item.asin.toUpperCase(), item]));
        const writes = [];

        for (const row of batch) {
          if (!row.asin) continue;
          const item = byAsin.get(row.asin.toUpperCase());
          if (!item || !(item.price > 0)) {
            missing += 1;
            continue;
          }
          if (!sanePrice(row.price, item.price)) {
            suspicious += 1;
            log(`SKIP ${row.asin} suspicious price $${row.price} → $${item.price}`);
            continue;
          }

          const originalPrice = Math.max(item.originalPrice || item.price, item.price);
          const discountPercent =
            originalPrice > item.price
              ? Math.round(((originalPrice - item.price) / originalPrice) * 1000) / 10
              : 0;
          const checkedAt = new Date(item.checkedAt);
          const specs = parseJson<Record<string, unknown>>(row.specifications, {});
          const images = item.images?.length ? JSON.stringify(item.images) : row.images;

          writes.push(
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
                availability: item.availability || "unknown",
                affiliateUrl: buildAmazonProductUrl(row.asin),
                lastUpdated: checkedAt,
                specifications: JSON.stringify({
                  ...specs,
                  priceSource: "amazon-creators-api",
                  priceCheckedAt: checkedAt.toISOString(),
                }),
              },
            }),
          );
          updated += 1;
          log(`OK ${row.asin} $${row.price} → $${item.price} ${row.title.slice(0, 55)}`);
        }

        if (writes.length) await prisma.$transaction(writes);
      } catch (error) {
        errors += batch.length;
        log(
          `ERROR batch ${offset + 1}-${offset + batch.length}: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    }

    if (updated > 0) {
      await prisma.cacheEntry.deleteMany({
        where: { key: { startsWith: "products:" } },
      });
    }

    await prisma.systemLog.create({
      data: {
        level: errors || suspicious ? "warn" : "info",
        source: "price-refresh",
        message: `Creators API refresh: ${updated} updated, ${missing} missing, ${suspicious} suspicious, ${errors} errors, ${rows.length} checked`,
      },
    });

    return { updated, missing, suspicious, errors, checked: rows.length };
  } finally {
    await prisma.$disconnect();
  }
}

refreshStalePrices()
  .then((result) => {
    console.log("\n=== Amazon Creators API price refresh ===");
    console.log(result);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
