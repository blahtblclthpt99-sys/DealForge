/**
 * Restore product images from local downloads + catalog files.
 * Avoids Amazon page scrapes that often pick up sprite icons.
 */
import { readFileSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { normalizeProductImage } from "../src/lib/product-image";

function loadJson(file: string): Array<{ asin: string; image?: string; images?: string[] }> {
  try {
    return JSON.parse(readFileSync(path.join(process.cwd(), file), "utf8"));
  } catch {
    return [];
  }
}

function isBadImage(url: string) {
  if (!url) return true;
  if (url.includes("placeholder")) return true;
  // Amazon UI sprites / tiny assets
  if (/\/I\/21[A-Za-z0-9]{8,}\._RC/i.test(url)) return true;
  if (/\/I\/[A-Za-z0-9]{6,12}\._RC/i.test(url)) return true;
  if (/sprite|transparent-pixel|grey-pixel/i.test(url)) return true;
  return false;
}

function pickGood(...candidates: Array<string | undefined>) {
  for (const c of candidates) {
    if (!c) continue;
    const n = normalizeProductImage(c);
    if (!isBadImage(n) && !isBadImage(c)) return n.startsWith("http") || n.startsWith("/") ? n : c;
  }
  return null;
}

async function main() {
  const prisma = new PrismaClient();
  const catalogs = [
    ...loadJson("prisma/amazon-catalog.json"),
    ...loadJson("prisma/amazon-discovered.json"),
    ...loadJson("prisma/amazon-bulk.json"),
  ];
  const byAsin = new Map<string, { image?: string; images?: string[] }>();
  for (const p of catalogs) {
    if (p.asin && !byAsin.has(p.asin)) byAsin.set(p.asin, p);
  }

  const rows = await prisma.product.findMany({
    where: { retailer: "amazon", asin: { not: null } },
    select: { id: true, asin: true, images: true, title: true },
  });

  let restored = 0;
  let kept = 0;
  let placeholder = 0;

  for (const row of rows) {
    const asin = row.asin!;
    const current = (JSON.parse(row.images || "[]") as string[])[0] || "";
    const fromCatalog = byAsin.get(asin);

    // Prefer catalog CDN URLs — local downloads were often wrong fallback photos.
    const next = pickGood(
      fromCatalog?.image,
      ...(fromCatalog?.images || []),
      !isBadImage(current) && !current.startsWith("/products/") ? current : undefined,
    );

    if (!next) {
      if (isBadImage(current) || !current) {
        await prisma.product.update({
          where: { id: row.id },
          data: { images: JSON.stringify(["/images/placeholder-product.svg"]) },
        });
        placeholder++;
      } else {
        kept++;
      }
      continue;
    }

    if (next !== current) {
      await prisma.product.update({
        where: { id: row.id },
        data: { images: JSON.stringify([next]) },
      });
      restored++;
    } else {
      kept++;
    }
  }

  await prisma.cacheEntry.deleteMany();
  console.log({ restored, kept, placeholder, total: rows.length });
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
