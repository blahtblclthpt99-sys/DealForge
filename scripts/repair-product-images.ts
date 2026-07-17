/**
 * Rewrite Amazon image URLs that break in browsers (+ in hash, weird .__AC_ tokens).
 * Usage: npx tsx scripts/repair-product-images.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function encodePlusInPath(url: string): string {
  const q = url.indexOf("?");
  const path = q >= 0 ? url.slice(0, q) : url;
  const qs = q >= 0 ? url.slice(q) : "";
  if (!path.includes("+")) return url;
  return path.replace(/\+/g, "%2B") + qs;
}

function stabilizeWeird(url: string): string {
  if (!/\.__AC_|FMwebp|_AC_SX\d+/i.test(url)) return url;
  const m = url.match(/^(https?:\/\/[^/]+\/images\/I\/[^./]+)/i);
  if (!m) return url;
  return `${m[1]}._AC_SL500_.jpg`;
}

function fixUrl(url: string): string {
  return encodePlusInPath(stabilizeWeird(url));
}

async function main() {
  const rows = await prisma.product.findMany({
    select: { id: true, images: true },
  });

  let updated = 0;
  let plus = 0;
  let weird = 0;

  for (const row of rows) {
    let imgs: string[] = [];
    try {
      imgs = JSON.parse(row.images || "[]") as string[];
    } catch {
      continue;
    }
    if (!imgs.length) continue;

    const next = imgs.map((u) => {
      if (u.includes("+")) plus++;
      if (/\.__AC_|FMwebp|_AC_SX\d+/i.test(u)) weird++;
      return fixUrl(u);
    });

    if (JSON.stringify(next) !== JSON.stringify(imgs)) {
      await prisma.product.update({
        where: { id: row.id },
        data: { images: JSON.stringify(next) },
      });
      updated++;
    }
  }

  // Bust product list caches so clients see rewritten URLs immediately
  const deleted = await prisma.cacheEntry.deleteMany({
    where: { key: { startsWith: "products:" } },
  });

  console.log(JSON.stringify({ scanned: rows.length, updated, plus, weird, cachesCleared: deleted.count }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
