/**
 * Scan Neon for broken/missing product images and repair with Amazon P/ CDN when possible.
 * Never deletes products.
 *
 * Usage: npx tsx scripts/repair-broken-cdn.ts [--limit 2000] [--concurrency 8]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 3000;
const concIdx = args.indexOf("--concurrency");
const CONCURRENCY = concIdx >= 0 ? Number(args[concIdx + 1]) : 10;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function pImage(asin: string) {
  return `https://m.media-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_SX500_.jpg`;
}

async function contentLength(url: string) {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": UA, Range: "bytes=0-0" },
      redirect: "follow",
    });
    if (!res.ok && res.status !== 206) return 0;
    const cr = res.headers.get("content-range");
    if (cr) {
      const total = Number(cr.split("/")[1] || 0);
      if (total > 0) return total;
    }
    const len = Number(res.headers.get("content-length") || 0);
    return len;
  } catch {
    return 0;
  }
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return out;
}

async function main() {
  const rows = await prisma.product.findMany({
    where: { retailer: "amazon", asin: { not: null } },
    select: { id: true, asin: true, title: true, images: true },
    orderBy: { lastUpdated: "desc" },
    take: LIMIT,
  });

  console.log(`Scanning ${rows.length} products…`);
  let ok = 0;
  let fixed = 0;
  let broken = 0;
  const stillBroken: string[] = [];

  await mapPool(rows, CONCURRENCY, async (row, idx) => {
    const list = (() => {
      try {
        return JSON.parse(row.images || "[]") as string[];
      } catch {
        return [] as string[];
      }
    })();
    const current = (list[0] || "").trim();
    const needs =
      !current ||
      current.includes("placeholder") ||
      current.includes("/images/P/") ||
      !/^https?:\/\//i.test(current);

    let bytes = 0;
    if (current.startsWith("http")) {
      bytes = await contentLength(current);
    }

    const good = bytes >= 2000;
    if (good && !current.includes("placeholder")) {
      ok++;
      if ((idx + 1) % 200 === 0) console.log(`… ${idx + 1}/${rows.length} ok=${ok} fixed=${fixed} broken=${broken}`);
      return;
    }

    if (!row.asin) {
      broken++;
      return;
    }

    const fallback = pImage(row.asin);
    const fbBytes = current === fallback ? bytes : await contentLength(fallback);
    if (fbBytes >= 2000) {
      await prisma.product.update({
        where: { id: row.id },
        data: { images: JSON.stringify([fallback]) },
      });
      fixed++;
      if (needs || !good) {
        // quiet unless batch
      }
      return;
    }

    broken++;
    stillBroken.push(row.asin);
    if (stillBroken.length <= 30) {
      console.log("BROKEN", row.asin, bytes, current.slice(0, 70), row.title.slice(0, 40));
    }
  });

  await prisma.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });

  const placeholdersLeft = await prisma.product.count({
    where: {
      OR: [
        { images: { contains: "placeholder" } },
        { images: { equals: "[]" } },
        { images: { equals: "" } },
      ],
    },
  });

  console.log("\n=== Scan complete ===");
  console.log({ ok, fixed, broken, placeholdersLeft, sampleBroken: stillBroken.slice(0, 20) });
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
