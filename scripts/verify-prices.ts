/**
 * Spot-check enriched product prices against live Amazon.
 * Usage: npx tsx scripts/verify-prices.ts [--sample 40]
 */
import { PrismaClient } from "@prisma/client";

const SAMPLE = (() => {
  const i = process.argv.indexOf("--sample");
  return i >= 0 ? Number(process.argv[i + 1]) : 40;
})();

const prisma = new PrismaClient();
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

async function amazonPrice(asin: string): Promise<number | null> {
  try {
    const res = await fetch(`https://www.amazon.com/gp/aw/d/${asin}`, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (/captcha|robot check/i.test(html.slice(0, 4000))) return null;
    const raw =
      html.match(/"priceAmount":\s*([0-9.]+)/)?.[1] ||
      html.match(/class="a-offscreen">\$([0-9.,]+)/)?.[1];
    if (!raw) return null;
    const n = parseFloat(raw.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function main() {
  const rows = await prisma.product.findMany({
    where: {
      AND: [
        { asin: { not: null } },
        { specifications: { contains: '"enrichedAt"' } },
      ],
    },
    select: { asin: true, title: true, price: true },
    orderBy: { lastUpdated: "desc" },
    take: SAMPLE * 3,
  });

  // shuffle-ish sample
  const picked = rows.sort(() => Math.random() - 0.5).slice(0, SAMPLE);
  let match = 0;
  let mismatch = 0;
  let unknown = 0;
  const mismatches: Array<{ asin: string; ours: number; amazon: number; title: string }> = [];

  for (const row of picked) {
    if (!row.asin) continue;
    await new Promise((r) => setTimeout(r, 900));
    const live = await amazonPrice(row.asin);
    if (live == null) {
      unknown++;
      continue;
    }
    const diff = Math.abs(live - row.price);
    // allow $1 or 2% variance (Amazon A/B and deal flicker)
    if (diff <= 1 || diff / live <= 0.02) {
      match++;
    } else {
      mismatch++;
      mismatches.push({
        asin: row.asin,
        ours: row.price,
        amazon: live,
        title: row.title.slice(0, 50),
      });
    }
  }

  const left = await prisma.product.count({
    where: {
      OR: [
        { specifications: { contains: '"needsEnrichment":true' } },
        { specifications: { contains: '"needsEnrichment": true' } },
      ],
    },
  });

  console.log(
    JSON.stringify(
      {
        checked: match + mismatch + unknown,
        match,
        mismatch,
        unknown,
        stillNeedEnrichment: left,
        mismatches: mismatches.slice(0, 15),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
