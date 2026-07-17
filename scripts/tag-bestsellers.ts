/**
 * Tag existing catalog products that appear on Amazon bestseller lists,
 * and import missing ones. Complements import-bestsellers-v2.ts.
 *
 * Usage: npx tsx scripts/tag-bestsellers.ts --limit 100
 */
import { PrismaClient } from "@prisma/client";
import { slugify } from "../src/lib/utils";
import { amazonDpLink } from "../src/lib/affiliate/providers/amazon";
import { AMAZON_ASSOCIATE_TAG } from "../src/lib/affiliate/amazon-config";
import { normalizeProductImage } from "../src/lib/product-image";
import { inferClothingSubcategory } from "../src/lib/clothing-subcategory";

const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Number(process.argv[i + 1]) : 100;
})();

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const SOURCES: Array<{ category: string; urls: string[] }> = [
  { category: "electronics", urls: ["https://www.amazon.com/Best-Sellers-Electronics/zgbs/electronics/", "https://www.amazon.com/Best-Sellers-Electronics/zgbs/electronics/ref=zg_bs_pg_2_electronics?_encoding=UTF8&pg=2"] },
  { category: "home-kitchen", urls: ["https://www.amazon.com/Best-Sellers-Home-Kitchen/zgbs/home-garden/", "https://www.amazon.com/Best-Sellers-Home-Kitchen/zgbs/home-garden/ref=zg_bs_pg_2_home-garden?_encoding=UTF8&pg=2"] },
  { category: "clothing", urls: ["https://www.amazon.com/Best-Sellers-Clothing-Shoes-Jewelry/zgbs/fashion/", "https://www.amazon.com/Best-Sellers-Clothing-Shoes-Jewelry/zgbs/fashion/ref=zg_bs_pg_2_fashion?_encoding=UTF8&pg=2"] },
  { category: "beauty", urls: ["https://www.amazon.com/Best-Sellers-Beauty/zgbs/beauty/", "https://www.amazon.com/Best-Sellers-Beauty/zgbs/beauty/ref=zg_bs_pg_2_beauty?_encoding=UTF8&pg=2"] },
  { category: "sports", urls: ["https://www.amazon.com/Best-Sellers-Sports-Outdoors/zgbs/sporting-goods/", "https://www.amazon.com/Best-Sellers-Sports-Outdoors/zgbs/sporting-goods/ref=zg_bs_pg_2_sporting-goods?_encoding=UTF8&pg=2"] },
  { category: "tools", urls: ["https://www.amazon.com/Best-Sellers-Tools-Home-Improvement/zgbs/hi/", "https://www.amazon.com/Best-Sellers-Tools-Home-Improvement/zgbs/hi/ref=zg_bs_pg_2_hi?_encoding=UTF8&pg=2"] },
  { category: "automotive", urls: ["https://www.amazon.com/Best-Sellers-Automotive/zgbs/automotive/", "https://www.amazon.com/Best-Sellers-Automotive/zgbs/automotive/ref=zg_bs_pg_2_automotive?_encoding=UTF8&pg=2"] },
  { category: "gaming", urls: ["https://www.amazon.com/Best-Sellers-Video-Games/zgbs/videogames/", "https://www.amazon.com/Best-Sellers-Video-Games/zgbs/videogames/ref=zg_bs_pg_2_videogames?_encoding=UTF8&pg=2"] },
  { category: "pet-supplies", urls: ["https://www.amazon.com/Best-Sellers-Pet-Supplies/zgbs/pet-supplies/", "https://www.amazon.com/Best-Sellers-Pet-Supplies/zgbs/pet-supplies/ref=zg_bs_pg_2_pet-supplies?_encoding=UTF8&pg=2"] },
  { category: "toys", urls: ["https://www.amazon.com/Best-Sellers-Toys-Games/zgbs/toys-and-games/", "https://www.amazon.com/Best-Sellers-Toys-Games/zgbs/toys-and-games/ref=zg_bs_pg_2_toys-and-games?_encoding=UTF8&pg=2"] },
  { category: "grocery", urls: ["https://www.amazon.com/Best-Sellers-Grocery-Gourmet-Food/zgbs/grocery/", "https://www.amazon.com/Best-Sellers-Grocery-Gourmet-Food/zgbs/grocery/ref=zg_bs_pg_2_grocery?_encoding=UTF8&pg=2"] },
  { category: "books", urls: ["https://www.amazon.com/best-sellers-books-Amazon/zgbs/books/", "https://www.amazon.com/best-sellers-books-Amazon/zgbs/books/ref=zg_bs_pg_2_books?_encoding=UTF8&pg=2"] },
  { category: "office", urls: ["https://www.amazon.com/Best-Sellers-Office-Products/zgbs/office-products/", "https://www.amazon.com/Best-Sellers-Office-Products/zgbs/office-products/ref=zg_bs_pg_2_office-products?_encoding=UTF8&pg=2"] },
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

function extractAsins(html: string) {
  const found = new Set<string>();
  const re = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?"]|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) found.add(m[1].toUpperCase());
  const re2 = /data-asin="([A-Z0-9]{10})"/gi;
  while ((m = re2.exec(html))) {
    if (m[1] && m[1] !== "0000000000") found.add(m[1].toUpperCase());
  }
  return [...found];
}

async function fetchAsins(url: string) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html" },
      redirect: "follow",
    });
    if (!res.ok) return [];
    const html = await res.text();
    if (/captcha|robot check|automated access/i.test(html.slice(0, 5000))) {
      console.log(`  blocked: ${url.slice(0, 70)}`);
      return [];
    }
    return extractAsins(html);
  } catch {
    return [];
  }
}

function isUsableImage(url: string) {
  if (!url || url.includes("placeholder")) return false;
  return /media-amazon\.com\/images\/[IP]\//i.test(url);
}

async function scrapeProduct(asin: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(2000);
    for (const [url, headers] of [
      [`https://www.amazon.com/gp/aw/d/${asin}`, { "User-Agent": UA_MOBILE, "Accept-Language": "en-US,en;q=0.9" }],
      [`https://www.amazon.com/dp/${asin}`, { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }],
    ] as const) {
      try {
        const res = await fetch(url, { headers, redirect: "follow" });
        if (!res.ok) continue;
        const html = await res.text();
        if (/captcha|robot check/i.test(html.slice(0, 4000))) continue;
        if (/page not found|currently unavailable\.?\s*we don't know when/i.test(html)) return null;

        const title = decode(
          html.match(/<span id="productTitle"[^>]*>\s*([^<]+)/)?.[1] ||
            html.match(/property="og:title"\s+content="([^"]+)/i)?.[1] ||
            "",
        )
          .replace(/\s*:\s*Amazon\.com.*$/i, "")
          .slice(0, 160);
        const rawImg =
          html.match(/property="og:image"\s+content="([^"]+)/i)?.[1] ||
          html.match(/"hiRes":"(https:\/\/m\.media-amazon\.com\/images\/[IP]\/[^"]+)"/)?.[1]?.replace(/\\u002F/g, "/") ||
          html.match(/(https:\/\/m\.media-amazon\.com\/images\/[IP]\/[A-Za-z0-9+\-_%,.]{10,})/)?.[1] ||
          `https://m.media-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_SX500_.jpg`;
        const image = rawImg ? normalizeProductImage(rawImg) : "";
        const priceRaw =
          html.match(/"priceAmount":\s*([0-9.]+)/)?.[1] ||
          html.match(/class="a-offscreen">\$([0-9.,]+)/)?.[1];
        const price = priceRaw ? parseFloat(priceRaw.replace(/,/g, "")) : 0;
        const listRaw = html.match(/List Price[^$]{0,40}\$([0-9.,]+)/i)?.[1];
        let original = listRaw ? parseFloat(listRaw.replace(/,/g, "")) : price;
        if (!(original > price) || original > price * 2.5) original = price;
        const brand =
          decode(html.match(/"brand":\s*"([^"]{2,40})"/)?.[1] || "") || title.split(/\s+/)[0] || "Amazon";
        const rating = parseFloat(html.match(/([0-9.]+) out of 5 stars/)?.[1] || "4.5");
        const reviewCount = parseInt(
          (html.match(/([0-9,]+)\s+(?:global )?ratings/i)?.[1] || "100").replace(/,/g, ""),
          10,
        );
        if (!title || title.length < 8) continue;
        if (!isUsableImage(image)) continue;
        if (!(price >= 1 && price < 5000)) continue;
        return {
          asin,
          title,
          brand,
          image,
          price,
          originalPrice: original,
          rating: Number.isFinite(rating) ? rating : 4.5,
          reviewCount: Number.isFinite(reviewCount) ? reviewCount : 100,
        };
      } catch {
        continue;
      }
    }
  }
  return null;
}

async function main() {
  const categories = await prisma.category.findMany();
  const bySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));
  const existingRows = await prisma.product.findMany({
    where: { asin: { not: null } },
    select: { id: true, asin: true, images: true, specifications: true },
  });
  const byAsin = new Map(existingRows.map((p) => [p.asin!.toUpperCase(), p]));

  const pool: Array<{ asin: string; category: string }> = [];
  for (const src of SOURCES) {
    console.log(`Category: ${src.category}`);
    for (const url of src.urls) {
      const asins = await fetchAsins(url);
      for (const asin of asins) {
        if (pool.some((p) => p.asin === asin)) continue;
        pool.push({ asin, category: src.category });
      }
      console.log(`  ${asins.length} from ${url.slice(40, 85)}`);
      await sleep(1200);
    }
  }
  console.log(`\nPool: ${pool.length} bestseller ASINs`);

  let tagged = 0;
  let added = 0;
  let skipped = 0;
  let featuredBudget = 20;

  for (const cand of pool) {
    const existing = byAsin.get(cand.asin);
    if (existing) {
      let images = existing.images;
      try {
        const first = (JSON.parse(images || "[]") as string[])[0] || "";
        if (!first || first.includes("placeholder")) {
          const scraped = await scrapeProduct(cand.asin);
          if (scraped?.image) images = JSON.stringify([scraped.image]);
          await sleep(1200);
        }
      } catch {
        /* keep */
      }
      const data: {
        images: string;
        trendingScore: number;
        specifications: string;
        isFeatured?: boolean;
      } = {
        images,
        trendingScore: 95,
        specifications: (() => {
          try {
            const s = JSON.parse(existing.specifications || "{}") as Record<string, unknown>;
            return JSON.stringify({ ...s, source: "bestsellers", bestseller: true });
          } catch {
            return JSON.stringify({ source: "bestsellers", bestseller: true });
          }
        })(),
      };
      if (featuredBudget > 0) {
        data.isFeatured = true;
        featuredBudget--;
      }
      await prisma.product.update({
        where: { id: existing.id },
        data,
      });
      tagged++;
      if (tagged % 25 === 0) console.log(`TAGGED ${tagged}…`);
      continue;
    }

    if (added >= LIMIT) continue;
    await sleep(1800 + Math.random() * 1000);
    const scraped = await scrapeProduct(cand.asin);
    if (!scraped) {
      skipped++;
      continue;
    }
    const cat = bySlug[cand.category] || bySlug.electronics;
    const slugBase = slugify(scraped.title).slice(0, 60) || scraped.asin.toLowerCase();
    let slug = slugBase;
    let n = 2;
    while (await prisma.product.findUnique({ where: { slug } })) slug = `${slugBase}-${n++}`;
    const discount =
      scraped.originalPrice > scraped.price
        ? Math.round(((scraped.originalPrice - scraped.price) / scraped.originalPrice) * 1000) / 10
        : 0;
    const makeFeatured = featuredBudget > 0;
    if (makeFeatured) featuredBudget--;
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
        specifications: JSON.stringify({ source: "bestsellers", bestseller: true }),
        trendingScore: 95,
        isFeatured: makeFeatured,
        isFlashDeal: discount >= 15,
      },
    });
    byAsin.set(cand.asin, { id: "new", asin: cand.asin, images: "[]", specifications: null });
    added++;
    console.log(`ADD  ${scraped.asin}  $${scraped.price}  ${scraped.title.slice(0, 55)}`);
  }

  await prisma.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });
  const placeholders = await prisma.product.count({ where: { images: { contains: "placeholder" } } });
  const empty = (
    await prisma.product.findMany({ select: { images: true } })
  ).filter((r) => {
    try {
      return !(JSON.parse(r.images || "[]") as string[])[0];
    } catch {
      return true;
    }
  }).length;
  const bs = await prisma.product.count({
    where: { OR: [{ specifications: { contains: "bestsellers" } }, { specifications: { contains: '"bestseller":true' } }] },
  });
  console.log(`\nDone: tagged=${tagged} added=${added} skipped=${skipped} bestsellers=${bs} placeholders=${placeholders} emptyImages=${empty}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
