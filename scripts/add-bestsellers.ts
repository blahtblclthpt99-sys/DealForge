/**
 * Fix placeholder images, then import Amazon bestsellers into Neon.
 *
 * Usage:
 *   npx tsx scripts/add-bestsellers.ts
 *   npx tsx scripts/add-bestsellers.ts --limit 250
 */
import { PrismaClient } from "@prisma/client";
import { slugify } from "../src/lib/utils";
import { amazonDpLink } from "../src/lib/affiliate/providers/amazon";
import { AMAZON_ASSOCIATE_TAG } from "../src/lib/affiliate/amazon-config";
import { normalizeProductImage } from "../src/lib/product-image";
import { inferClothingSubcategory } from "../src/lib/clothing-subcategory";

const args = process.argv.slice(2);
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 300;

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const UA_DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const BESTSELLER_NODES: Array<{ category: string; node: string; label: string }> = [
  { category: "electronics", node: "172282", label: "Electronics" },
  { category: "home-kitchen", node: "1055398", label: "Home & Kitchen" },
  { category: "clothing", node: "7141123011", label: "Clothing" },
  { category: "beauty", node: "3760911", label: "Beauty" },
  { category: "sports", node: "3375251", label: "Sports & Outdoors" },
  { category: "tools", node: "228013", label: "Tools & Home Improvement" },
  { category: "automotive", node: "15684181", label: "Automotive" },
  { category: "gaming", node: "468642", label: "Video Games" },
  { category: "pet-supplies", node: "2619533011", label: "Pet Supplies" },
  { category: "office", node: "1064954", label: "Office Products" },
  { category: "toys", node: "165793011", label: "Toys & Games" },
  { category: "grocery", node: "16310101", label: "Grocery" },
  { category: "books", node: "283155", label: "Books" },
  { category: "outdoor", node: "3400371", label: "Camping & Hiking" },
];

function decode(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function pImage(asin: string) {
  return `https://m.media-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_SX500_.jpg`;
}

async function imageBytes(url: string) {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": UA_DESKTOP, Range: "bytes=0-0" },
      redirect: "follow",
    });
    if (!res.ok && res.status !== 206) return 0;
    const cr = res.headers.get("content-range");
    if (cr) return Number(cr.split("/")[1] || 0);
    return Number(res.headers.get("content-length") || 0);
  } catch {
    return 0;
  }
}

async function fixPlaceholders() {
  const rows = await prisma.product.findMany({
    where: {
      OR: [
        { images: { contains: "placeholder" } },
        { images: { equals: "[]" } },
        { images: { equals: "" } },
      ],
    },
    select: { id: true, asin: true, title: true, images: true },
  });
  console.log(`Placeholders to fix: ${rows.length}`);
  let fixed = 0;
  let removed = 0;

  for (const row of rows) {
    if (!row.asin) {
      await prisma.product.delete({ where: { id: row.id } });
      removed++;
      continue;
    }
    // Try live scrape first
    const scraped = await scrapeProduct(row.asin);
    if (scraped?.image && !scraped.image.includes("placeholder")) {
      await prisma.product.update({
        where: { id: row.id },
        data: { images: JSON.stringify([scraped.image]) },
      });
      fixed++;
      console.log(`IMG  ${row.asin}  ${scraped.image.slice(0, 60)}`);
      await sleep(800);
      continue;
    }
    const cdn = pImage(row.asin);
    const bytes = await imageBytes(cdn);
    if (bytes >= 2000) {
      await prisma.product.update({
        where: { id: row.id },
        data: { images: JSON.stringify([cdn]) },
      });
      fixed++;
      console.log(`P/   ${row.asin}  ${bytes}b`);
      continue;
    }
    // Keep placeholder rather than delete — bestsellers pass will replace catalog gaps
    console.log(`SKIP ${row.asin}  no image`);
    await sleep(400);
  }
  console.log(`Image fix: fixed=${fixed} removed=${removed}`);
}

function extractAsins(html: string) {
  const found = new Set<string>();
  const re = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) found.add(m[1].toUpperCase());
  const re2 = /data-asin="([A-Z0-9]{10})"/gi;
  while ((m = re2.exec(html))) found.add(m[1].toUpperCase());
  return [...found];
}

async function scrapeBestsellerAsins(node: string, pages = 3) {
  const asins: string[] = [];
  for (let page = 1; page <= pages; page++) {
    const urls = [
      `https://www.amazon.com/Best-Sellers/zgbs/ref=zg_bs_pg_${page}_1?_encoding=UTF8&pg=${page}&node=${node}`,
      `https://www.amazon.com/gp/bestsellers/?node=${node}&pg=${page}`,
      `https://www.amazon.com/Best-Sellers-${encodeURIComponent("Amazon")}/zgbs/?pg=${page}`,
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
        const found = extractAsins(html);
        asins.push(...found);
        if (found.length >= 10) break;
      } catch {
        /* next */
      }
    }
    await sleep(1400 + Math.random() * 800);
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

async function scrapeProduct(asin: string): Promise<Scraped | null> {
  const urls = [`https://www.amazon.com/gp/aw/d/${asin}`, `https://www.amazon.com/dp/${asin}`];
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
        /currently unavailable\.?\s*we don't know when/i.test(html) &&
        !/add.?to.?cart|id="add-to-cart-button"/i.test(html)
      ) {
        return null;
      }

      const title = decode(
        html.match(/<span id="productTitle"[^>]*>\s*([^<]+)/)?.[1] ||
          html.match(/property="og:title"\s+content="([^"]+)/i)?.[1] ||
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
        const p = pImage(asin);
        if ((await imageBytes(p)) >= 2000) image = p;
      }

      const priceRaw =
        html.match(/"priceAmount":\s*([0-9.]+)/)?.[1] ||
        html.match(/class="a-offscreen">\$([0-9.,]+)/)?.[1];
      let price = priceRaw ? parseFloat(priceRaw.replace(/,/g, "")) : 0;
      if (!(price >= 0.5 && price < 5000)) price = 0;
      const listRaw = html.match(/List Price[^$]{0,40}\$([0-9.,]+)/i)?.[1];
      let originalPrice = listRaw ? parseFloat(listRaw.replace(/,/g, "")) : price;
      if (!(originalPrice > price) || originalPrice > price * 2.5) originalPrice = price;

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
      if (!(price > 0)) continue;

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

async function insertProduct(
  scraped: Scraped,
  categorySlug: string,
  bySlug: Record<string, { id: string; slug: string }>,
) {
  const existing = await prisma.product.findFirst({ where: { asin: scraped.asin } });
  if (existing) {
    // Ensure image is set if missing
    const imgs = (() => {
      try {
        return JSON.parse(existing.images || "[]") as string[];
      } catch {
        return [];
      }
    })();
    const cur = imgs[0] || "";
    if (!cur || cur.includes("placeholder")) {
      await prisma.product.update({
        where: { id: existing.id },
        data: {
          images: JSON.stringify([scraped.image]),
          price: scraped.price,
          originalPrice: scraped.originalPrice,
          discountPercent:
            scraped.originalPrice > scraped.price
              ? Math.round(((scraped.originalPrice - scraped.price) / scraped.originalPrice) * 1000) /
                10
              : 0,
          lastUpdated: new Date(),
        },
      });
      return "updated";
    }
    return "exists";
  }

  const cat = bySlug[categorySlug] || bySlug.electronics;
  if (!cat) throw new Error("missing category");
  const slugBase = slugify(scraped.title).slice(0, 60) || scraped.asin.toLowerCase();
  let slug = slugBase;
  let n = 2;
  while (await prisma.product.findUnique({ where: { slug } })) {
    slug = `${slugBase}-${n++}`;
  }
  const discount =
    scraped.originalPrice > scraped.price
      ? Math.round(((scraped.originalPrice - scraped.price) / scraped.originalPrice) * 1000) / 10
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
      specifications: JSON.stringify({ source: "bestsellers" }),
      trendingScore: 85,
      isFeatured: false,
      isFlashDeal: discount >= 20,
    },
  });
  return "added";
}

async function addBestsellers() {
  const categories = await prisma.category.findMany();
  const bySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));
  const existing = new Set(
    (await prisma.product.findMany({ where: { asin: { not: null } }, select: { asin: true } })).map(
      (p) => p.asin!.toUpperCase(),
    ),
  );

  const pool: Array<{ asin: string; category: string }> = [];
  for (const node of BESTSELLER_NODES) {
    console.log(`Bestsellers: ${node.label}`);
    const asins = await scrapeBestsellerAsins(node.node, 3);
    let newCount = 0;
    for (const asin of asins) {
      if (existing.has(asin)) continue;
      if (pool.some((p) => p.asin === asin)) continue;
      pool.push({ asin, category: node.category });
      newCount++;
    }
    console.log(`  scraped ${asins.length}, new in pool +${newCount} (pool=${pool.length})`);
  }

  console.log(`\nImporting up to ${LIMIT} bestsellers from pool of ${pool.length}…`);
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const cand of pool) {
    if (added >= LIMIT) break;
    await sleep(900 + Math.random() * 600);
    const scraped = await scrapeProduct(cand.asin);
    if (!scraped) {
      skipped++;
      console.log(`SKIP ${cand.asin}`);
      continue;
    }
    const result = await insertProduct(scraped, cand.category, bySlug);
    if (result === "added") {
      added++;
      existing.add(cand.asin);
      console.log(`ADD  ${cand.asin}  $${scraped.price}  ${scraped.title.slice(0, 50)}`);
    } else if (result === "updated") {
      updated++;
      console.log(`UPD  ${cand.asin}`);
    } else {
      skipped++;
    }
  }

  await prisma.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });
  console.log(`\nBestsellers done: added=${added} updated=${updated} skipped=${skipped}`);
}

async function main() {
  await fixPlaceholders();
  await addBestsellers();
  const left = await prisma.product.count({
    where: {
      OR: [
        { images: { contains: "placeholder" } },
        { images: { equals: "[]" } },
        { images: { equals: "" } },
      ],
    },
  });
  const total = await prisma.product.count();
  console.log(`\nFinal: products=${total} placeholdersLeft=${left}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
