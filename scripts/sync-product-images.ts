/**
 * Sync product images from live Amazon pages. Fixes wrong local fallbacks and
 * title/image mismatches (recycled ASINs, bad seed data).
 *
 * Usage:
 *   npx tsx scripts/sync-product-images.ts              # local paths + placeholders
 *   npx tsx scripts/sync-product-images.ts --all        # full catalog (~15k, slow)
 *   npx tsx scripts/sync-product-images.ts --limit 500
 *   npx tsx scripts/sync-product-images.ts --dry-run
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { normalizeProductImage } from "../src/lib/product-image";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const ALL = args.includes("--all");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : ALL ? Infinity : Infinity;
const CONCURRENCY = 5;
const TITLE_MIN_OVERLAP = 0.22;
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

type AmazonMeta = {
  title: string | null;
  image: string | null;
  dead: boolean;
  blocked: boolean;
};

function tokenize(s: string) {
  return new Set(
    s
      .toLowerCase()
      .replace(/&[^;]+;/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function titleOverlap(a: string, b: string) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

function amazonImageId(url: string | null | undefined) {
  if (!url) return null;
  const m = url.match(/\/images\/I\/([A-Za-z0-9+\-]+)/i);
  return m?.[1]?.split(".")[0] ?? null;
}

function cleanAmazonTitle(raw: string) {
  return raw
    .replace(/\s*:\s*Amazon\.com.*$/i, "")
    .replace(/\s*-\s*Amazon\.com.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchAmazonMeta(asin: string): Promise<AmazonMeta> {
  const urls = [
    `https://www.amazon.com/gp/aw/d/${asin}`,
    `https://www.amazon.com/dp/${asin}`,
  ];
  const headerSets = [
    { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
    {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  ];

  for (let i = 0; i < urls.length; i++) {
    try {
      const r = await fetch(urls[i], {
        headers: headerSets[i] || headerSets[0],
        redirect: "follow",
      });
      const html = await r.text();
      const head = html.slice(0, 8000);
      if (/captcha|robot check|automated access/i.test(head)) continue;
      if (
        /page not found|looking for something that isn.t here|Sorry!\s*We couldn|dogs of Amazon|We couldn't find that page/i.test(
          html,
        )
      ) {
        return { title: null, image: null, dead: true, blocked: false };
      }
      const rawTitle =
        html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1] ||
        html.match(/content="([^"]+)"\s+property="og:title"/i)?.[1] ||
        html.match(/id="productTitle"[^>]*>\s*([^<]+)/i)?.[1];
      const rawImg =
        html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1] ||
        html.match(/"hiRes":"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/)?.[1]?.replace(
          /\\u002F/g,
          "/",
        ) ||
        html.match(/(https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9+\-_%,.]{10,})/)?.[1];
      const title = rawTitle ? cleanAmazonTitle(rawTitle) : null;
      const image = rawImg ? normalizeProductImage(rawImg) : null;
      if (title || image) {
        return { title, image, dead: false, blocked: false };
      }
    } catch {
      continue;
    }
  }
  return { title: null, image: null, dead: false, blocked: true };
}

/** Known-good CDN URLs from attach-product-images BASE (curated). */
function loadCuratedCdnMap(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const catalog = JSON.parse(
      readFileSync(path.join(process.cwd(), "prisma", "amazon-catalog.json"), "utf8"),
    ) as Array<{ asin: string; image?: string; images?: string[] }>;
    for (const p of catalog) {
      const cdn = [p.image, ...(p.images || [])].find((u) => u?.startsWith("https://"));
      if (cdn) map.set(p.asin, normalizeProductImage(cdn));
    }
  } catch {
    /* ignore */
  }
  return map;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return out;
}

async function main() {
  const prisma = new PrismaClient();
  const curatedCdn = loadCuratedCdnMap();

  const where = ALL
    ? { retailer: "amazon" as const, asin: { not: null } }
    : {
        retailer: "amazon" as const,
        asin: { not: null },
        OR: [
          { images: { contains: "/products/" } },
          { images: { contains: "placeholder" } },
        ],
      };

  const rows = await prisma.product.findMany({
    where,
    select: { id: true, asin: true, title: true, images: true },
    orderBy: { createdAt: "asc" },
  });
  const list = rows.filter((r) => r.asin).slice(0, LIMIT);
  console.log(
    `Syncing ${list.length} products (all=${ALL}, dry=${DRY}, concurrency=${CONCURRENCY})…`,
  );

  let updated = 0;
  let removed = 0;
  let ok = 0;
  let blocked = 0;
  const removedAsins: string[] = [];

  await mapPool(list, CONCURRENCY, async (row, i) => {
    const asin = row.asin!;
    const currentList = JSON.parse(row.images || "[]") as string[];
    const current = normalizeProductImage(currentList[0]);

    // Fast path: curated CDN for local-only rows
    if (current.startsWith("/products/") && curatedCdn.has(asin)) {
      const cdn = curatedCdn.get(asin)!;
      if (!DRY) {
        await prisma.product.update({
          where: { id: row.id },
          data: { images: JSON.stringify([cdn]) },
        });
        const localPath = path.join(process.cwd(), "public", "products", `${asin}.jpg`);
        if (existsSync(localPath)) unlinkSync(localPath);
      }
      updated++;
      if ((i + 1) % 50 === 0) console.log(`… ${i + 1}/${list.length}`);
      return;
    }

    let meta = await fetchAmazonMeta(asin);
    if (meta.blocked) {
      await new Promise((r) => setTimeout(r, 2000));
      meta = await fetchAmazonMeta(asin);
    }
    await new Promise((r) => setTimeout(r, 250 + Math.random() * 350));

    if (meta.blocked) {
      blocked++;
      return;
    }

    if (meta.dead) {
      if (!DRY) {
        await prisma.product.delete({ where: { id: row.id } });
      }
      removed++;
      removedAsins.push(asin);
      console.log(`REMOVE ${asin}  dead page  ${row.title.slice(0, 50)}`);
      return;
    }

    if (meta.blocked || !meta.image || meta.image.includes("placeholder")) {
      blocked++;
      return;
    }

    if (meta.title) {
      const overlap = titleOverlap(row.title, meta.title);
      if (overlap < TITLE_MIN_OVERLAP) {
        if (!DRY) {
          await prisma.product.delete({ where: { id: row.id } });
        }
        removed++;
        removedAsins.push(asin);
        console.log(
          `REMOVE ${asin}  title mismatch (${overlap.toFixed(2)})  ours="${row.title.slice(0, 40)}" amazon="${meta.title.slice(0, 40)}"`,
        );
        return;
      }
    }

    const curId = amazonImageId(current);
    const amzId = amazonImageId(meta.image);
    const needsUpdate =
      current.startsWith("/products/") ||
      current.includes("placeholder") ||
      (curId && amzId && curId !== amzId) ||
      (!curId && meta.image !== current);

    if (needsUpdate && meta.image) {
      if (!DRY) {
        await prisma.product.update({
          where: { id: row.id },
          data: { images: JSON.stringify([meta.image]) },
        });
        const localPath = path.join(process.cwd(), "public", "products", `${asin}.jpg`);
        if (existsSync(localPath)) unlinkSync(localPath);
      }
      updated++;
      console.log(`UPDATE ${asin}  ${row.title.slice(0, 45)}`);
    } else {
      ok++;
    }

    if ((i + 1) % 100 === 0) {
      console.log(`… ${i + 1}/${list.length}  ok=${ok} updated=${updated} removed=${removed}`);
    }
  });

  // Patch catalog JSON files for removed ASINs
  if (removedAsins.length && !DRY) {
    for (const file of [
      "prisma/amazon-discovered.json",
      "prisma/amazon-bulk.json",
      "prisma/amazon-catalog.json",
    ]) {
      const full = path.join(process.cwd(), file);
      if (!existsSync(full)) continue;
      const data = JSON.parse(readFileSync(full, "utf8")) as Array<{ asin: string }>;
      const next = data.filter((p) => !removedAsins.includes(String(p.asin || "").toUpperCase()));
      if (next.length !== data.length) {
        writeFileSync(full, JSON.stringify(next, null, file.includes("bulk") ? 0 : 2));
      }
    }
  }

  if (!DRY) await prisma.cacheEntry.deleteMany();

  console.log("\n=== Sync complete ===");
  console.log(`ok=${ok} updated=${updated} removed=${removed} blocked=${blocked}`);
  const remaining = await prisma.product.count();
  console.log(`products in DB: ${remaining}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
