/**
 * Repair broken / missing product images by re-fetching Amazon og:image.
 * Usage: npx tsx scripts/repair-images.ts [--limit 300]
 */
import { PrismaClient } from "@prisma/client";
import { normalizeProductImage } from "../src/lib/product-image";

const limitIdx = process.argv.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : 400;
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

async function imageOk(url: string) {
  try {
    const r = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": UA, Referer: "" },
      redirect: "follow",
    });
    const type = r.headers.get("content-type") || "";
    const len = Number(r.headers.get("content-length") || 0);
    // Don't download full body — abort after headers via ok check; some CDNs need GET
    if (!r.ok || !type.includes("image")) return false;
    if (len > 0 && len < 800) return false;
    // Drain a bit then cancel to avoid huge downloads
    try {
      await r.body?.cancel();
    } catch {
      /* ignore */
    }
    return true;
  } catch {
    return false;
  }
}

async function scrapeImage(asin: string) {
  try {
    const r = await fetch(`https://www.amazon.com/gp/aw/d/${asin}`, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
      redirect: "follow",
    });
    const html = await r.text();
    if (/captcha|robot check|page not found/i.test(html.slice(0, 5000))) return null;
    const img =
      html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1] ||
      html.match(/"hiRes":"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/)?.[1]?.replace(
        /\\u002F/g,
        "/",
      ) ||
      html.match(/(https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9+\-_%,.]{10,})/)?.[1];
    return img ? normalizeProductImage(img) : null;
  } catch {
    return null;
  }
}

async function main() {
  const prisma = new PrismaClient();
  const rows = await prisma.product.findMany({
    where: { retailer: "amazon", asin: { not: null } },
    select: { id: true, asin: true, images: true, title: true },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
  });

  console.log(`Checking ${rows.length} products for broken images…`);
  let fixed = 0;
  let ok = 0;
  let failed = 0;

  for (const row of rows) {
    const list = JSON.parse(row.images || "[]") as string[];
    const current = normalizeProductImage(list[0]);
    if (await imageOk(current)) {
      ok++;
      // Still rewrite stored URL to normalized form if different
      if (list[0] !== current) {
        await prisma.product.update({
          where: { id: row.id },
          data: { images: JSON.stringify([current, ...list.slice(1)]) },
        });
      }
      continue;
    }

    const fresh = row.asin ? await scrapeImage(row.asin) : null;
    if (fresh && (await imageOk(fresh))) {
      await prisma.product.update({
        where: { id: row.id },
        data: { images: JSON.stringify([fresh]) },
      });
      fixed++;
      console.log(`FIXED ${row.asin}  ${row.title.slice(0, 50)}`);
    } else {
      failed++;
      // Keep a placeholder so UI never shows a broken icon
      await prisma.product.update({
        where: { id: row.id },
        data: { images: JSON.stringify(["/images/placeholder-product.svg"]) },
      });
      console.log(`PLACEHOLDER ${row.asin}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log(`\nok=${ok} fixed=${fixed} placeholder=${failed}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
