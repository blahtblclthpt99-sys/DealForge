/**
 * Audit DealForge Amazon prices.
 *
 * - Structural/freshness audit always runs.
 * - Live Amazon comparison uses Creators API only.
 * - No HTML scraping is used.
 *
 * Usage:
 *   npx tsx scripts/verify-prices.ts
 *   npx tsx scripts/verify-prices.ts --sample 40
 *   npx tsx scripts/verify-prices.ts --require-live
 */
import { PrismaClient } from "@prisma/client";
import {
  amazonCreatorsConfigured,
  getAmazonCreatorItems,
} from "../src/lib/affiliate/amazon-creators";
import { parseJson } from "../src/lib/utils";

const SAMPLE = (() => {
  const i = process.argv.indexOf("--sample");
  const raw = i >= 0 ? Number(process.argv[i + 1]) : 40;
  return Number.isFinite(raw) && raw > 0 ? Math.min(200, Math.floor(raw)) : 40;
})();
const REQUIRE_LIVE = process.argv.includes("--require-live");
const PRICE_TTL_MS = 24 * 60 * 60 * 1000;

const prisma = new PrismaClient();

function trustedFresh(row: { lastUpdated: Date; specifications: string }) {
  const specs = parseJson<Record<string, unknown>>(row.specifications, {});
  const source = typeof specs.priceSource === "string" ? specs.priceSource : "";
  const rawChecked = typeof specs.priceCheckedAt === "string" ? specs.priceCheckedAt : "";
  const checkedMs = rawChecked ? Date.parse(rawChecked) : row.lastUpdated.getTime();
  return (
    source === "amazon-creators-api" &&
    Number.isFinite(checkedMs) &&
    Date.now() - checkedMs <= PRICE_TTL_MS
  );
}

async function main() {
  const rows = await prisma.product.findMany({
    where: { retailer: "amazon", asin: { not: null } },
    select: {
      asin: true,
      title: true,
      price: true,
      originalPrice: true,
      discountPercent: true,
      lastUpdated: true,
      specifications: true,
      clickCount: true,
      viewCount: true,
    },
    orderBy: [{ clickCount: "desc" }, { viewCount: "desc" }, { lastUpdated: "asc" }],
  });

  const invalid = rows.filter(
    (row) =>
      !Number.isFinite(row.price) ||
      row.price <= 0 ||
      row.originalPrice < row.price ||
      row.discountPercent < 0 ||
      row.discountPercent > 100,
  );
  const fresh = rows.filter(trustedFresh);
  const stale = rows.length - fresh.length;

  const baseReport = {
    amazonProducts: rows.length,
    invalidCommerceRows: invalid.length,
    trustedFreshPrices: fresh.length,
    staleOrRecordedPrices: stale,
    creatorsApiConfigured: amazonCreatorsConfigured(),
  };

  if (!amazonCreatorsConfigured()) {
    console.log(JSON.stringify({ ...baseReport, liveComparison: "skipped-no-creators-api-credentials" }, null, 2));
    if (invalid.length) process.exitCode = 1;
    if (REQUIRE_LIVE) process.exitCode = 1;
    return;
  }

  const picked = rows.slice(0, SAMPLE);
  let match = 0;
  let mismatch = 0;
  let missing = 0;
  const mismatches: Array<{ asin: string; recorded: number; amazon: number; title: string }> = [];

  for (let offset = 0; offset < picked.length; offset += 10) {
    const batch = picked.slice(offset, offset + 10);
    const items = await getAmazonCreatorItems(batch.flatMap((row) => (row.asin ? [row.asin] : [])));
    const byAsin = new Map(items.map((item) => [item.asin.toUpperCase(), item]));

    for (const row of batch) {
      if (!row.asin) continue;
      const live = byAsin.get(row.asin.toUpperCase());
      if (!live || !(live.price > 0)) {
        missing += 1;
        continue;
      }
      const diff = Math.abs(live.price - row.price);
      if (diff <= 1 || diff / live.price <= 0.02) {
        match += 1;
      } else {
        mismatch += 1;
        mismatches.push({
          asin: row.asin,
          recorded: row.price,
          amazon: live.price,
          title: row.title.slice(0, 70),
        });
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        ...baseReport,
        liveComparison: {
          requested: picked.length,
          matched: match,
          mismatched: mismatch,
          missing,
          mismatches: mismatches.slice(0, 20),
        },
      },
      null,
      2,
    ),
  );

  if (invalid.length || mismatch) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
