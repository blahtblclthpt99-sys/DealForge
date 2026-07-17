/**
 * Prune Amazon products that are dead or currently unavailable,
 * then replace them with live bestseller ASINs (scraped + verified).
 *
 * Usage:
 *   npx tsx scripts/prune-and-replace.ts
 *   npx tsx scripts/prune-and-replace.ts --limit 500
 *   npx tsx scripts/prune-and-replace.ts --dry-run
 *   npx tsx scripts/prune-and-replace.ts --replace-only 50
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { slugify } from "../src/lib/utils";
import { amazonDpLink } from "../src/lib/affiliate/providers/amazon";
import { AMAZON_ASSOCIATE_TAG } from "../src/lib/affiliate/amazon-config";
import { normalizeProductImage } from "../src/lib/product-image";
import { inferClothingSubcategory } from "../src/lib/clothing-subcategory";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
const offsetIdx = args.indexOf("--offset");
const OFFSET = offsetIdx >= 0 ? Number(args[offsetIdx + 1]) : 0;
const replaceOnlyIdx = args.indexOf("--replace-only");
const REPLACE_ONLY = replaceOnlyIdx >= 0 ? Number(args[replaceOnlyIdx + 1]) : null;
const CONCURRENCY = 5;
const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const UA_DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

type Verdict = "ok" | "dead" | "unavailable" | "blocked" | "error";

const BESTSELLER_NODES: Array<{ category: string; node: string; label: string }> = [
  { category: "electronics", node: "172282", label: "Electronics" },
  { category: "home-kitchen", node: "1055398", label: "Home & Kitchen" },
  { category: "clothing", node: "7141123011", label: "Clothing" },
  { category: "beauty", node: "3760911", label: "Beauty" },
  { category: "sports", node: "3375251", label: "Sports" },
  { category: "tools", node: "228013", label: "Tools" },
  { category: "automotive", node: "15684181", label: "Automotive" },
  { category: "gaming", node: "468642", label: "Video Games" },
  { category: "pet-supplies", node: "2619533011", label: "Pet Supplies" },
  { category: "office", node: "1064954", label: "Office" },
  { category: "outdoor", node: "3375251", label: "Outdoor/Sports" },
  { category: "toys", node: "165793011", label: "Toys" },
  { category: "grocery", node: "16310101", label: "Grocery" },
  { category: "books", node: "283155", label: "Books" },
];

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function decode(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
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

async function checkAsin(asin: string): Promise<Verdict> {
  try {
    const res = await fetch(`https://www.amazon.com/gp/aw/d/${asin}`, {
      headers: { "User-Agent": UA_MOBILE, "Accept-Language": "en-US,en;q=0.9" },
      redirect: "follow",
    });
    const html = await res.text();
    const head = html.slice(0, 8000);
    if (/captcha|robot check|automated access/i.test(head)) return "blocked";
    if (
      /page not found|looking for something that isn.t here|Sorry!\s*We couldn|dogs of Amazon|not a functioning page|We couldn't find that page/i.test(
        html,
      )
    ) {
      return "dead";
    }
    if (res.status === 404) return "dead";

    // Soft-unavailable: listing exists but cannot be purchased
    if (
      /currently unavailable\.?\s*we don't know when|this item is no longer available|temporary out of stock\.?\s*we don't know when|this product is not available/i.test(
        html,
      )
    ) {
      return "unavailable";
    }
    // Shorter pattern only when Add to Cart is clearly absent
    if (
      /currently unavailable/i.test(html) &&
      !/name="submit\.add-to-cart"|id="add-to-cart-button"|add to cart/i.test(html)
    ) {
      return "unavailable";
    }

    const hasProduct =
      (/id="productTitle"|property="og:title"|og:image|"priceAmount"|data-asin=/i.test(html) ||
        /\$\d/.test(html)) &&
      !/Page Not Found/i.test(html.slice(0, 500));
    if (!hasProduct) return "dead";
    return "ok";
  } catch {
    return "error";
  }
}

function extractAsinsFromHtml(html: string) {
  const found = new Set<string>();
  const re = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    found.add(m[1].toUpperCase());
  }
  // data-asin attributes
  const re2 = /data-asin="([A-Z0-9]{10})"/gi;
  while ((m = re2.exec(html))) {
    found.add(m[1].toUpperCase());
  }
  return [...found];
}

async function scrapeBestsellerAsins(node: string, pages = 2): Promise<string[]> {
  const asins: string[] = [];
  for (let page = 1; page <= pages; page++) {
    const urls = [
      `https://www.amazon.com/Best-Sellers/zgbs/ref=zg_bs_pg_${page}_1?_encoding=UTF8&pg=${page}&node=${node}`,
      `https://www.amazon.com/gp/bestsellers/?node=${node}&pg=${page}`,
    ];
    for (const u of urls) {
      try {
        const res = await fetch(u, {
          headers: {
            "User-Agent": UA_DESKTOP,
            "Accept-Language": "en-US,en;q=0.9",
            Accept: "text/html",
          },
          redirect: "follow",
        });
        if (!res.ok) continue;
        const html = await res.text();
        if (/captcha|robot check/i.test(html.slice(0, 4000))) continue;
        const found = extractAsinsFromHtml(html);
        asins.push(...found);
        if (found.length) break;
      } catch {
        /* try next */
      }
    }
    await sleep(1200 + Math.random() * 800);
  }
  return [...new Set(asins)];
}

type Scraped = {
  asin: string;
  title: string;
  brand: string;
  image: string;
  price: number;
  originalPrice: number;
  rating: number;
  reviewCount: number;
};

async function scrapeLiveProduct(asin: string): Promise<Scraped | null> {
  const urls = [
    `https://www.amazon.com/gp/aw/d/${asin}`,
    `https://www.amazon.com/dp/${asin}`,
  ];
  const headers = [
    { "User-Agent": UA_MOBILE, "Accept-Language": "en-US,en;q=0.9" },
    { "User-Agent": UA_DESKTOP, "Accept-Language": "en-US,en;q=0.9" },
  ];
  for (let i = 0; i < urls.length; i++) {
    try {
      const res = await fetch(urls[i], { headers: headers[i], redirect: "follow" });
      if (!res.ok) continue;
      const html = await res.text();
      if (/captcha|robot check/i.test(html.slice(0, 4000))) continue;
      if (/page not found|not a functioning page/i.test(html)) return null;
      if (
        /currently unavailable|we don't know when or if this item will be back in stock/i.test(html) &&
        !/add.?to.?cart|buy.?now|a-button-input/i.test(html)
      ) {
        return null;
      }

      const title = decode(
        html.match(/<span id="productTitle"[^>]*>\s*([^<]+)/)?.[1] ||
          html.match(/property="og:title"\s+content="([^"]+)/i)?.[1] ||
          html.match(/content="([^"]+)"\s+property="og:title"/i)?.[1] ||
          "",
      )
        .replace(/\s*:\s*Amazon\.com.*$/i, "")
        .replace(/^Amazon\.com\s*:\s*/i, "")
        .slice(0, 160);
      const rawImg =
        html.match(/property="og:image"\s+content="([^"]+)/i)?.[1] ||
        html.match(/"hiRes":"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/)?.[1]?.replace(
          /\\u002F/g,
          "/",
        ) ||
        html.match(/(https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9+\-_%,.]{10,})/)?.[1];
      let image = rawImg ? normalizeProductImage(rawImg) : "";
      if (!image || image.includes("placeholder")) {
        const pImg = `https://m.media-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_SX500_.jpg`;
        image = pImg;
      }
      const priceRaw =
        html.match(/"priceAmount":\s*([0-9.]+)/)?.[1] ||
        html.match(/class="a-offscreen">\$([0-9.,]+)/)?.[1] ||
        html.match(/\$([0-9]+\.[0-9]{2})/)?.[1];
      let price = priceRaw ? parseFloat(priceRaw.replace(/,/g, "")) : 0;
      if (!(price > 0 && price < 10000)) price = 19.99; // keep listing if live but price obscured
      const listRaw = html.match(/List Price[^$]*\$([0-9.,]+)/i)?.[1];
      const originalPrice = listRaw ? parseFloat(listRaw.replace(/,/g, "")) : Math.round(price * 1.25 * 100) / 100;
      const brand =
        decode(html.match(/"brand":\s*"([^"]{2,40})"/)?.[1] || "") ||
        decode(html.match(/Visit the ([^<]{2,40}) Store/i)?.[1] || "") ||
        title.split(/\s+/)[0] ||
        "Amazon";
      const rating = parseFloat(html.match(/([0-9.]+) out of 5 stars/)?.[1] || "4.5");
      const reviewCount = parseInt(
        (html.match(/([0-9,]+)\s+(?:global )?ratings/i)?.[1] || "100").replace(/,/g, ""),
        10,
      );

      if (!title || title.length < 8) continue;
      if (!image || image.includes("placeholder")) continue;
      // Require a real /images/I/ photo when possible; allow P/ only if HEAD size is large
      if (image.includes("/images/P/")) {
        try {
          const head = await fetch(image, {
            headers: { "User-Agent": UA_DESKTOP, Range: "bytes=0-0" },
          });
          const cr = head.headers.get("content-range");
          const bytes = cr ? Number(cr.split("/")[1] || 0) : Number(head.headers.get("content-length") || 0);
          if (bytes < 2000) continue;
        } catch {
          continue;
        }
      }
      return {
        asin,
        title,
        brand,
        image,
        price,
        originalPrice: originalPrice > price ? originalPrice : price,
        rating: Number.isFinite(rating) ? rating : 4.5,
        reviewCount: Number.isFinite(reviewCount) ? reviewCount : 100,
      };
    } catch {
      continue;
    }
  }
  return null;
}

function patchCatalogJson(deadAsins: Set<string>, added: Array<Scraped & { category: string }>) {
  const files = [
    "prisma/amazon-discovered.json",
    "prisma/amazon-bulk.json",
    "prisma/amazon-catalog.json",
  ];
  for (const file of files) {
    const full = path.join(process.cwd(), file);
    if (!existsSync(full)) continue;
    let data: Array<Record<string, unknown>> = [];
    try {
      data = JSON.parse(readFileSync(full, "utf8"));
    } catch {
      continue;
    }
    const before = data.length;
    data = data.filter((p) => !deadAsins.has(String(p.asin || "").toUpperCase()));
    if (file.includes("discovered") && added.length) {
      for (const a of added) {
        if (data.some((p) => String(p.asin).toUpperCase() === a.asin)) continue;
        data.push({
          asin: a.asin,
          category: a.category,
          title: a.title,
          brand: a.brand,
          image: a.image,
          images: [a.image],
          price: a.price,
          originalPrice: a.originalPrice,
          rating: a.rating,
          reviewCount: a.reviewCount,
          featured: false,
          flash: false,
        });
      }
    }
    if (data.length !== before || (file.includes("discovered") && added.length)) {
      writeFileSync(full, JSON.stringify(data, null, file.includes("bulk") ? 0 : 2));
      console.log(`Patched ${file}: ${before} → ${data.length}`);
    }
  }
}

async function insertProduct(
  scraped: Scraped,
  categorySlug: string,
  bySlug: Record<string, { id: string; slug: string }>,
) {
  const cat = bySlug[categorySlug] || bySlug.electronics;
  if (!cat) throw new Error("missing category");
  const existing = await prisma.product.findFirst({ where: { asin: scraped.asin } });
  if (existing) return false;

  const slugBase = slugify(scraped.title).slice(0, 60) || scraped.asin.toLowerCase();
  let slug = slugBase;
  let n = 2;
  while (await prisma.product.findUnique({ where: { slug } })) {
    slug = `${slugBase}-${n++}`;
  }
  const discount =
    scraped.originalPrice > scraped.price
      ? Math.round(((scraped.originalPrice - scraped.price) / scraped.originalPrice) * 100)
      : 0;

  await prisma.product.create({
    data: {
      asin: scraped.asin,
      slug,
      title: scraped.title,
      description: scraped.title,
      brand: scraped.brand,
      categoryId: cat.id,
      subcategory:
        cat.slug === "clothing" ? inferClothingSubcategory(scraped.title, scraped.brand) : null,
      images: JSON.stringify([scraped.image]),
      price: scraped.price,
      originalPrice: scraped.originalPrice,
      discountPercent: discount,
      rating: scraped.rating,
      reviewCount: scraped.reviewCount,
      affiliateUrl: amazonDpLink(scraped.asin, AMAZON_ASSOCIATE_TAG),
      retailer: "amazon",
      availability: "in_stock",
      specifications: JSON.stringify({}),
      trendingScore: 70,
      isFeatured: false,
      isFlashDeal: false,
    },
  });
  return true;
}

async function prune() {
  const rows = await prisma.product.findMany({
    where: { retailer: "amazon", asin: { not: null } },
    select: { id: true, asin: true, title: true },
    orderBy: { createdAt: "asc" },
  });
  const list = rows.filter((r) => r.asin).slice(OFFSET, OFFSET === 0 && LIMIT === Infinity ? undefined : OFFSET + (Number.isFinite(LIMIT) ? LIMIT : rows.length));
  console.log(
    `Checking ${list.length} Amazon products (offset=${OFFSET})${DRY ? " [dry-run]" : ""}…`,
  );

  const remove: string[] = [];
  const blocked: string[] = [];
  let ok = 0;
  let errors = 0;
  let done = 0;

  await mapPool(list, CONCURRENCY, async (row) => {
    const asin = row.asin!;
    let verdict = await checkAsin(asin);
    if (verdict === "blocked" || verdict === "error") {
      await sleep(1500 + Math.random() * 1500);
      verdict = await checkAsin(asin);
    }
    done++;
    if (verdict === "ok") ok++;
    else if (verdict === "dead" || verdict === "unavailable") {
      remove.push(asin);
      console.log(`${verdict.toUpperCase().padEnd(12)} ${asin}  ${row.title.slice(0, 55)}`);
    } else if (verdict === "blocked") blocked.push(asin);
    else errors++;

    if (done % 100 === 0) {
      console.log(
        `… ${done}/${list.length}  ok=${ok} remove=${remove.length} blocked=${blocked.length}`,
      );
    }
    await sleep(180 + Math.random() * 320);
  });

  // Slow retry blocked
  if (blocked.length) {
    console.log(`\nRetrying ${blocked.length} blocked…`);
    const still: string[] = [];
    for (const asin of blocked) {
      await sleep(2500);
      const v = await checkAsin(asin);
      if (v === "dead" || v === "unavailable") {
        remove.push(asin);
        console.log(`${v.toUpperCase()} ${asin} (retry)`);
      } else if (v === "ok") ok++;
      else still.push(asin);
    }
    blocked.length = 0;
    blocked.push(...still);
  }

  const deadSet = new Set(remove.map((a) => a.toUpperCase()));
  if (deadSet.size && !DRY) {
    const result = await prisma.product.deleteMany({ where: { asin: { in: [...deadSet] } } });
    console.log(`\nDeleted ${result.count} unavailable/dead products`);
    await prisma.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });
  }

  console.log("\n=== Prune results ===");
  console.log({ ok, remove: remove.length, blocked: blocked.length, errors });
  return deadSet;
}

async function replace(count: number) {
  if (count <= 0) {
    console.log("Nothing to replace.");
    return [] as Array<Scraped & { category: string }>;
  }
  console.log(`\nFinding ~${count} live replacement products from Amazon bestsellers…`);

  const categories = await prisma.category.findMany();
  const bySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));
  const existing = new Set(
    (
      await prisma.product.findMany({
        where: { asin: { not: null } },
        select: { asin: true },
      })
    )
      .map((p) => p.asin!.toUpperCase())
      .filter(Boolean),
  );

  const candidates: Array<{ asin: string; category: string }> = [];
  // Known current replacements for popular discontinued ASINs
  const SEED_REPLACEMENTS: Array<{ asin: string; category: string }> = [
    { asin: "B0CQMRKRV5", category: "electronics" }, // Fire TV Stick HD (current)
    { asin: "B0B1NND231", category: "electronics" }, // Fire TV Stick 4K
    { asin: "B09B8V15DZ", category: "electronics" }, // Echo Dot 5th gen
    { asin: "B0D1XD1ZV3", category: "electronics" },
    { asin: "B00SMBFP0A", category: "electronics" },
    { asin: "B07QR73T66", category: "beauty" },
    { asin: "B000GAWSDG", category: "tools" },
    { asin: "B01LSUQSB0", category: "beauty" },
    { asin: "B07PZC8L2H", category: "beauty" },
    { asin: "B0CRH74TD6", category: "clothing" },
    { asin: "B0FD8D9NJF", category: "clothing" },
  ];

  for (const s of SEED_REPLACEMENTS) {
    if (existing.has(s.asin)) continue;
    if (candidates.some((c) => c.asin === s.asin)) continue;
    candidates.push(s);
  }

  for (const node of BESTSELLER_NODES) {
    if (candidates.length >= count * 3) break;
    console.log(`Bestsellers: ${node.label}`);
    const asins = await scrapeBestsellerAsins(node.node, 2);
    for (const asin of asins) {
      if (existing.has(asin)) continue;
      if (candidates.some((c) => c.asin === asin)) continue;
      candidates.push({ asin, category: node.category });
    }
    console.log(`  got ${asins.length} ASINs (pool=${candidates.length})`);
  }

  const added: Array<Scraped & { category: string }> = [];
  for (const cand of candidates) {
    if (added.length >= count) break;
    await sleep(900 + Math.random() * 700);
    const scraped = await scrapeLiveProduct(cand.asin);
    if (!scraped) {
      console.log(`SKIP ${cand.asin} (not purchasable)`);
      continue;
    }
    // Double-check availability (dead pages only — soft price blocks already handled)
    const v = await checkAsin(cand.asin);
    if (v === "dead" || v === "unavailable") {
      console.log(`SKIP ${cand.asin} (${v})`);
      continue;
    }
    if (v === "blocked") {
      // still allow if scrape succeeded with title+image
      console.log(`WARN ${cand.asin} blocked but scraped — adding`);
    }
    if (DRY) {
      console.log(`WOULD ADD ${cand.asin} ${scraped.title.slice(0, 50)}`);
      added.push({ ...scraped, category: cand.category });
      continue;
    }
    const ok = await insertProduct(scraped, cand.category, bySlug);
    if (ok) {
      existing.add(cand.asin);
      added.push({ ...scraped, category: cand.category });
      console.log(`ADD  ${cand.asin}  ${scraped.title.slice(0, 55)}`);
    }
  }

  console.log(`\nReplaced/added ${added.length} live products`);
  return added;
}

async function main() {
  let deadSet = new Set<string>();
  let targetReplace = REPLACE_ONLY ?? 0;

  if (REPLACE_ONLY == null) {
    deadSet = await prune();
    targetReplace = deadSet.size;
  }

  const added = await replace(Math.min(targetReplace, 200)); // cap replacements per run
  if (!DRY) patchCatalogJson(deadSet, added);

  const remaining = await prisma.product.count();
  console.log(`\nProducts in DB: ${remaining}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
