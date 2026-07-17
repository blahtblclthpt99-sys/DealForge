/**
 * Import bestsellers using category-specific zgbs URLs + search popularity.
 * Usage: npx tsx scripts/import-bestsellers-v2.ts --limit 200
 */
import { PrismaClient } from "@prisma/client";
import { slugify } from "../src/lib/utils";
import { amazonDpLink } from "../src/lib/affiliate/providers/amazon";
import { AMAZON_ASSOCIATE_TAG } from "../src/lib/affiliate/amazon-config";
import { normalizeProductImage } from "../src/lib/product-image";
import { inferClothingSubcategory } from "../src/lib/clothing-subcategory";

const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Number(process.argv[i + 1]) : 200;
})();

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const SOURCES: Array<{ category: string; urls: string[] }> = [
  {
    category: "electronics",
    urls: [
      "https://www.amazon.com/Best-Sellers-Electronics/zgbs/electronics/",
      "https://www.amazon.com/Best-Sellers-Electronics/zgbs/electronics/ref=zg_bs_pg_2_electronics?_encoding=UTF8&pg=2",
      "https://www.amazon.com/s?k=electronics&s=exact-aware-popularity-rank&rh=n%3A172282",
    ],
  },
  {
    category: "home-kitchen",
    urls: [
      "https://www.amazon.com/Best-Sellers-Home-Kitchen/zgbs/home-garden/",
      "https://www.amazon.com/Best-Sellers-Home-Kitchen/zgbs/home-garden/ref=zg_bs_pg_2_home-garden?_encoding=UTF8&pg=2",
      "https://www.amazon.com/s?k=home+kitchen&s=exact-aware-popularity-rank",
    ],
  },
  {
    category: "clothing",
    urls: [
      "https://www.amazon.com/Best-Sellers-Clothing-Shoes-Jewelry/zgbs/fashion/",
      "https://www.amazon.com/Best-Sellers-Clothing-Shoes-Jewelry/zgbs/fashion/ref=zg_bs_pg_2_fashion?_encoding=UTF8&pg=2",
      "https://www.amazon.com/s?k=womens+clothing&s=exact-aware-popularity-rank",
    ],
  },
  {
    category: "beauty",
    urls: [
      "https://www.amazon.com/Best-Sellers-Beauty/zgbs/beauty/",
      "https://www.amazon.com/Best-Sellers-Beauty/zgbs/beauty/ref=zg_bs_pg_2_beauty?_encoding=UTF8&pg=2",
    ],
  },
  {
    category: "sports",
    urls: [
      "https://www.amazon.com/Best-Sellers-Sports-Outdoors/zgbs/sporting-goods/",
      "https://www.amazon.com/Best-Sellers-Sports-Outdoors/zgbs/sporting-goods/ref=zg_bs_pg_2_sporting-goods?_encoding=UTF8&pg=2",
    ],
  },
  {
    category: "tools",
    urls: [
      "https://www.amazon.com/Best-Sellers-Tools-Home-Improvement/zgbs/hi/",
      "https://www.amazon.com/Best-Sellers-Tools-Home-Improvement/zgbs/hi/ref=zg_bs_pg_2_hi?_encoding=UTF8&pg=2",
    ],
  },
  {
    category: "automotive",
    urls: [
      "https://www.amazon.com/Best-Sellers-Automotive/zgbs/automotive/",
      "https://www.amazon.com/Best-Sellers-Automotive/zgbs/automotive/ref=zg_bs_pg_2_automotive?_encoding=UTF8&pg=2",
    ],
  },
  {
    category: "gaming",
    urls: [
      "https://www.amazon.com/Best-Sellers-Video-Games/zgbs/videogames/",
      "https://www.amazon.com/Best-Sellers-Video-Games/zgbs/videogames/ref=zg_bs_pg_2_videogames?_encoding=UTF8&pg=2",
    ],
  },
  {
    category: "pet-supplies",
    urls: [
      "https://www.amazon.com/Best-Sellers-Pet-Supplies/zgbs/pet-supplies/",
      "https://www.amazon.com/Best-Sellers-Pet-Supplies/zgbs/pet-supplies/ref=zg_bs_pg_2_pet-supplies?_encoding=UTF8&pg=2",
    ],
  },
  {
    category: "toys",
    urls: [
      "https://www.amazon.com/Best-Sellers-Toys-Games/zgbs/toys-and-games/",
      "https://www.amazon.com/Best-Sellers-Toys-Games/zgbs/toys-and-games/ref=zg_bs_pg_2_toys-and-games?_encoding=UTF8&pg=2",
    ],
  },
  {
    category: "grocery",
    urls: [
      "https://www.amazon.com/Best-Sellers-Grocery-Gourmet-Food/zgbs/grocery/",
      "https://www.amazon.com/Best-Sellers-Grocery-Gourmet-Food/zgbs/grocery/ref=zg_bs_pg_2_grocery?_encoding=UTF8&pg=2",
    ],
  },
  {
    category: "books",
    urls: [
      "https://www.amazon.com/best-sellers-books-Amazon/zgbs/books/",
      "https://www.amazon.com/best-sellers-books-Amazon/zgbs/books/ref=zg_bs_pg_2_books?_encoding=UTF8&pg=2",
    ],
  },
  {
    category: "office",
    urls: [
      "https://www.amazon.com/Best-Sellers-Office-Products/zgbs/office-products/",
      "https://www.amazon.com/Best-Sellers-Office-Products/zgbs/office-products/ref=zg_bs_pg_2_office-products?_encoding=UTF8&pg=2",
    ],
  },
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
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
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
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(1500 + attempt * 1000);
    for (const [url, headers] of [
      [
        `https://www.amazon.com/gp/aw/d/${asin}`,
        { "User-Agent": UA_MOBILE, "Accept-Language": "en-US,en;q=0.9" },
      ],
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
          html.match(/"hiRes":"(https:\/\/m\.media-amazon\.com\/images\/[IP]\/[^"]+)"/)?.[1]?.replace(
            /\\u002F/g,
            "/",
          ) ||
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
          decode(html.match(/"brand":\s*"([^"]{2,40})"/)?.[1] || "") ||
          title.split(/\s+/)[0] ||
          "Amazon";
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
  const existing = new Set(
    (await prisma.product.findMany({ where: { asin: { not: null } }, select: { asin: true } })).map(
      (p) => p.asin!.toUpperCase(),
    ),
  );

  const pool: Array<{ asin: string; category: string }> = [];
  for (const src of SOURCES) {
    console.log(`Category: ${src.category}`);
    const before = pool.length;
    for (const url of src.urls) {
      const asins = await fetchAsins(url);
      for (const asin of asins) {
        if (existing.has(asin)) continue;
        if (pool.some((p) => p.asin === asin)) continue;
        pool.push({ asin, category: src.category });
      }
      console.log(`  ${asins.length} ASINs from ${url.slice(40, 90) || url}`);
      await sleep(1500);
    }
    console.log(`  pool +${pool.length - before} (total ${pool.length})`);
  }

  console.log(`\nImporting up to ${LIMIT} from pool ${pool.length}…`);
  let added = 0;
  let skipped = 0;

  for (const cand of pool) {
    if (added >= LIMIT) break;
    await sleep(1800 + Math.random() * 1200);
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
        trendingScore: 90,
        isFeatured: added < 12,
        isFlashDeal: discount >= 15,
      },
    });
    existing.add(cand.asin);
    added++;
    console.log(`ADD  ${scraped.asin}  $${scraped.price}  ${scraped.title.slice(0, 55)}`);
  }

  // Remove remaining placeholders that still have no usable image
  const placeholders = await prisma.product.findMany({
    where: { images: { contains: "placeholder" } },
    select: { id: true, asin: true },
  });
  for (const row of placeholders) {
    if (!row.asin) {
      await prisma.product.delete({ where: { id: row.id } });
      continue;
    }
    const scraped = await scrapeProduct(row.asin);
    if (scraped?.image) {
      await prisma.product.update({
        where: { id: row.id },
        data: { images: JSON.stringify([scraped.image]) },
      });
      console.log(`IMG  ${row.asin}`);
    } else {
      await prisma.product.delete({ where: { id: row.id } });
      console.log(`DEL  ${row.asin}  (no image)`);
    }
    await sleep(800);
  }

  await prisma.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });
  const left = await prisma.product.count({ where: { images: { contains: "placeholder" } } });
  const total = await prisma.product.count();
  console.log(`\nDone: added=${added} skipped=${skipped} products=${total} placeholders=${left}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
