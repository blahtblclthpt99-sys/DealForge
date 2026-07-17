/**
 * Find products whose Amazon image URLs are dead / tiny / "unavailable".
 * Optionally rewrite to working CDN P/ASIN or delete if unrecoverable.
 *
 * Usage:
 *   npx tsx scripts/fix-dead-images.ts --check 500
 *   npx tsx scripts/fix-dead-images.ts --fix
 */
import { PrismaClient } from "@prisma/client";

const CHECK = (() => {
  const i = process.argv.indexOf("--check");
  return i >= 0 ? Number(process.argv[i + 1]) : 800;
})();
const DO_FIX = process.argv.includes("--fix");

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function firstImage(raw: string) {
  try {
    return (JSON.parse(raw || "[]") as string[])[0] || "";
  } catch {
    return "";
  }
}

function cdnP(asin: string) {
  return `https://m.media-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_SX500_.jpg`;
}

async function probe(url: string): Promise<{ ok: boolean; bytes: number; status: number }> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        Referer: "",
      },
      redirect: "follow",
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: res.ok && buf.length >= 2500, bytes: buf.length, status: res.status };
  } catch {
    return { ok: false, bytes: 0, status: 0 };
  }
}

async function main() {
  // Prefer likely-broken: featured, newest, or /images/I/ that may 404
  const rows = await prisma.product.findMany({
    where: { retailer: "amazon", asin: { not: null } },
    select: { id: true, asin: true, images: true, title: true, createdAt: true, isFeatured: true },
    orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }],
    take: CHECK,
  });

  let dead = 0;
  let fixed = 0;
  let alreadyOk = 0;
  const deadSamples: string[] = [];

  for (const row of rows) {
    const img = firstImage(row.images);
    if (!img || img.includes("placeholder")) {
      dead++;
      if (DO_FIX && row.asin) {
        const alt = cdnP(row.asin);
        const p = await probe(alt);
        if (p.ok) {
          await prisma.product.update({
            where: { id: row.id },
            data: { images: JSON.stringify([alt]) },
          });
          fixed++;
        }
      }
      continue;
    }

    const p = await probe(img);
    if (p.ok) {
      alreadyOk++;
      continue;
    }

    dead++;
    if (deadSamples.length < 8) {
      deadSamples.push(`${row.asin} status=${p.status} bytes=${p.bytes} ${img.slice(0, 70)}`);
    }

    if (DO_FIX && row.asin) {
      const alt = cdnP(row.asin);
      // Don't re-probe same URL
      if (alt !== img) {
        const p2 = await probe(alt);
        if (p2.ok) {
          await prisma.product.update({
            where: { id: row.id },
            data: { images: JSON.stringify([alt]) },
          });
          fixed++;
          continue;
        }
      }
      // Try I/ isn't possible without hash — leave for scrape later
    }
    await sleep(30);
  }

  if (DO_FIX) {
    await prisma.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });
  }

  console.log(
    JSON.stringify(
      { checked: rows.length, alreadyOk, dead, fixed, doFix: DO_FIX, deadSamples },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
