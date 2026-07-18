/**
 * Import infant products by navigating Amazon DP pages in Playwright.
 * Requires real title + price + matching image before insert.
 */
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { slugify } from "../src/lib/utils";
import { amazonDpLink } from "../src/lib/affiliate/providers/amazon";
import { normalizeProductImage } from "../src/lib/product-image";

const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Number(process.argv[i + 1]) : 35;
})();

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function looksInfant(title: string) {
  return /\b(infant|infants|baby|babies|newborn|newborns|toddler|0-3\s*month|3-6\s*month|6-12\s*month|onesie|onesies|bodysuit|pacifier|teether|bottle|diaper|wipes|swaddle|bassinet|crib|stroller|nursery|formula|breast\s*pump|burp cloth|bibs?\b|rattle|play ?mat|activity gym|carrier|car seat|sippy|sterilizer|breastmilk|nursing|huggies|pampers|gerber|avent|dr\.?\s*brown)\b/i.test(
    title,
  );
}

function isOlderKids(title: string) {
  return (
    /\b(teen|school uniform|middle school|elementary|chino shorts|performance socks)\b/i.test(
      title,
    ) && !/\b(infant|newborn|baby|onesie|0-3|3-6|6-12)\b/i.test(title)
  );
}

function categorize(title: string): { category: string; subcategory: string | null } {
  if (
    /\b(onesie|bodysuit|romper|pajama|pyjama|socks|hat|mitten|bootie|gown|kimono|outfit|shirt|pants|dress|bib)\b/i.test(
      title,
    )
  ) {
    return { category: "clothing", subcategory: "infant" };
  }
  if (/\b(toy|rattle|teether|playmat|play mat|activity gym|stuffed|plush|mobile)\b/i.test(title)) {
    return { category: "toys", subcategory: null };
  }
  return { category: "home-kitchen", subcategory: null };
}

type Scraped = {
  title: string;
  brand: string;
  image: string;
  price: number;
  originalPrice: number;
  rating: number;
  reviewCount: number;
};

async function scrapeDp(
  page: import("playwright").Page,
  asin: string,
): Promise<Scraped | { blocked: true } | null> {
  const url = `https://www.amazon.com/dp/${asin}?th=1&psc=1`;
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    if (!res || res.status() === 404) return null;
    await sleep(800);

    const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    if (/enter the characters you see|robot check|automated access/i.test(bodyText.slice(0, 500))) {
      return { blocked: true };
    }

    const data = await page.evaluate(() => {
      const titleEl =
        document.querySelector("#productTitle") ||
        document.querySelector("#title") ||
        document.querySelector("h1");
      const title = (titleEl?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 180);

      const priceEl =
        document.querySelector(".a-price .a-offscreen") ||
        document.querySelector("#priceblock_ourprice") ||
        document.querySelector("#priceblock_dealprice") ||
        document.querySelector('[data-a-color="price"] .a-offscreen');
      const priceText = (priceEl?.textContent || "").replace(/[^0-9.]/g, "");
      const price = parseFloat(priceText) || 0;

      const og = document.querySelector('meta[property="og:image"]')?.getAttribute("content") || "";
      const imgEl =
        document.querySelector("#landingImage") ||
        document.querySelector("#imgTagWrapperId img") ||
        document.querySelector("#main-image");
      const image =
        og ||
        imgEl?.getAttribute("src") ||
        imgEl?.getAttribute("data-old-hires") ||
        imgEl?.getAttribute("data-a-dynamic-image")?.match(/"(https:[^"]+)"/)?.[1] ||
        "";

      const brandEl =
        document.querySelector("#bylineInfo") ||
        document.querySelector('a#brand') ||
        document.querySelector(".po-brand .po-break-word");
      let brand = (brandEl?.textContent || "")
        .replace(/^(Visit the|Brand:)\s*/i, "")
        .replace(/\s+Store$/i, "")
        .trim()
        .slice(0, 40);
      if (!brand) brand = title.split(/\s+/)[0] || "Amazon";

      const ratingText =
        document.querySelector('[data-hook="rating-out-of-text"]')?.textContent ||
        document.querySelector(".a-icon-alt")?.textContent ||
        "";
      const rating = parseFloat((ratingText.match(/([0-9.]+)/) || [])[1] || "4.5");

      const reviewText =
        document.querySelector("#acrCustomerReviewText")?.textContent ||
        document.querySelector('[data-hook="total-review-count"]')?.textContent ||
        "";
      const reviewCount = parseInt((reviewText.match(/([0-9,]+)/) || [])[1]?.replace(/,/g, "") || "100", 10);

      const listEl = document.querySelector(".basisPrice .a-offscreen") ||
        document.querySelector('[data-a-strike="true"] .a-offscreen');
      const listPrice = parseFloat((listEl?.textContent || "").replace(/[^0-9.]/g, "")) || price;

      return { title, brand, image, price, originalPrice: listPrice, rating, reviewCount };
    });

    if (!data.title || data.title.length < 8) return null;
    if (!(data.price >= 1 && data.price < 5000)) return null;
    if (!data.image || !/media-amazon\.com\/images\/[IP]\//i.test(data.image)) return null;

    let original = data.originalPrice;
    if (!(original > data.price) || original > data.price * 2.5) original = data.price;

    return {
      title: data.title,
      brand: data.brand,
      image: normalizeProductImage(data.image),
      price: data.price,
      originalPrice: original,
      rating: Number.isFinite(data.rating) ? data.rating : 4.5,
      reviewCount: Number.isFinite(data.reviewCount) ? data.reviewCount : 100,
    };
  } catch {
    return null;
  }
}

async function main() {
  const categories = await prisma.category.findMany();
  const bySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));
  const existing = new Set(
    (
      await prisma.product.findMany({
        where: { asin: { not: null } },
        select: { asin: true },
      })
    ).map((p) => p.asin!.toUpperCase()),
  );

  const before = await prisma.product.count({ where: { subcategory: "infant" } });
  console.log(`infant_sub before=${before}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    locale: "en-US",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  await page.goto("https://www.amazon.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(2000);

  const discoveryUrls = [
    "https://www.amazon.com/Best-Sellers-Baby/zgbs/baby-products/",
    "https://www.amazon.com/Best-Sellers-Baby/zgbs/baby-products/ref=zg_bs_pg_2_baby-products?_encoding=UTF8&pg=2",
    "https://www.amazon.com/Best-Sellers-Baby-Toys/zgbs/toys-and-games/166764011/",
    "https://www.amazon.com/Best-Sellers-Baby-Clothing-Shoes-Accessories/zgbs/fashion/1044512/",
  ];

  const pool: string[] = [];
  for (const url of discoveryUrls) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await sleep(1800);
      const asins = await page.evaluate(() => {
        const found = new Set<string>();
        for (const a of document.querySelectorAll<HTMLAnchorElement>("a[href*='/dp/']")) {
          const m = a.href.match(/\/dp\/([A-Z0-9]{10})/i);
          if (m?.[1]) found.add(m[1].toUpperCase());
        }
        for (const el of document.querySelectorAll("[data-asin]")) {
          const a = el.getAttribute("data-asin");
          if (a && /^[A-Z0-9]{10}$/i.test(a) && a !== "0000000000") found.add(a.toUpperCase());
        }
        return [...found];
      });
      for (const a of asins) {
        if (!existing.has(a) && !pool.includes(a)) pool.push(a);
      }
      console.log(`pool ${pool.length} after ${url.slice(40, 85)}`);
    } catch (e) {
      console.log(`discovery fail: ${(e as Error).message}`);
    }
  }

  console.log(`\nScraping up to ${LIMIT} of ${pool.length}`);
  let added = 0;
  let skipped = 0;
  let blocked = 0;
  const samples: Array<{ asin: string; title: string; price: number; image: string }> = [];

  for (const asin of pool) {
    if (added >= LIMIT) break;
    await sleep(1500 + Math.random() * 1200);
    const scraped = await scrapeDp(page, asin);
    if (scraped && "blocked" in scraped) {
      blocked++;
      console.log(`BLOCKED ${asin} — pausing 20s`);
      await sleep(20000);
      continue;
    }
    if (!scraped) {
      skipped++;
      console.log(`FAIL ${asin}`);
      continue;
    }
    if (!looksInfant(scraped.title) || isOlderKids(scraped.title)) {
      skipped++;
      console.log(`SKIP ${asin}: ${scraped.title.slice(0, 55)}`);
      continue;
    }

    const { category, subcategory } = categorize(scraped.title);
    const cat = bySlug[category] || bySlug["home-kitchen"];
    const slugBase = slugify(scraped.title).slice(0, 60) || asin.toLowerCase();
    let slug = `${slugBase}-${asin.toLowerCase()}`.slice(0, 180);
    let n = 2;
    while (await prisma.product.findUnique({ where: { slug } })) {
      slug = `${slugBase}-${n++}-${asin.toLowerCase()}`.slice(0, 180);
    }

    const discount =
      scraped.originalPrice > scraped.price
        ? Math.round(((scraped.originalPrice - scraped.price) / scraped.originalPrice) * 1000) / 10
        : 0;

    await prisma.product.create({
      data: {
        asin,
        slug,
        title: scraped.title,
        description: `${scraped.title} — available on Amazon via DealForge.`,
        brand: scraped.brand,
        categoryId: cat.id,
        subcategory,
        images: JSON.stringify([scraped.image]),
        price: scraped.price,
        originalPrice: scraped.originalPrice,
        discountPercent: discount,
        rating: scraped.rating,
        reviewCount: scraped.reviewCount,
        affiliateUrl: amazonDpLink(asin),
        retailer: "amazon",
        availability: "in_stock",
        specifications: JSON.stringify({
          Brand: scraped.brand,
          ASIN: asin,
          Retailer: "Amazon",
          Source: "infant-dp-nav",
          ...(subcategory ? { Department: subcategory } : {}),
        }),
        trendingScore: 95,
        isFeatured: added < 20,
        isFlashDeal: discount >= 15,
        lastUpdated: new Date(),
      },
    });

    existing.add(asin);
    added++;
    samples.push({
      asin,
      title: scraped.title,
      price: scraped.price,
      image: scraped.image,
    });
    console.log(
      `OK $${scraped.price.toFixed(2)} ${asin} [${cat.slug}/${subcategory ?? "-"}] ${scraped.title.slice(0, 50)}`,
    );
  }

  await browser.close();
  await prisma.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });

  const after = await prisma.product.count({ where: { subcategory: "infant" } });
  const infantish = await prisma.product.count({
    where: {
      OR: [
        { subcategory: "infant" },
        { title: { contains: "infant", mode: "insensitive" } },
        { title: { contains: "newborn", mode: "insensitive" } },
        { title: { contains: "baby", mode: "insensitive" } },
      ],
    },
  });

  console.log(`\nDone added=${added} skipped=${skipped} blocked=${blocked}`);
  console.log(`infant_sub ${before} -> ${after}; infantish=${infantish}`);
  for (const s of samples) {
    console.log(`  ${s.asin} $${s.price.toFixed(2)} ${s.title.slice(0, 60)}`);
    console.log(`    ${s.image}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
