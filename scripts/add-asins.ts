/**
 * Add specific user-provided Amazon ASINs (deduped).
 * Usage: npx tsx scripts/add-asins.ts B0DZM1WVCS B0DYLG399L ...
 */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { slugify } from "../src/lib/utils";
import { amazonDpLink } from "../src/lib/affiliate/providers/amazon";
import { normalizeProductImage } from "../src/lib/product-image";
import { inferClothingSubcategory } from "../src/lib/clothing-subcategory";

const ASINS = process.argv.slice(2).map((a) => a.toUpperCase()).filter(Boolean);
if (!ASINS.length) {
  console.error("Pass one or more ASINs");
  process.exit(1);
}

const ROOT = process.cwd();
const DISCOVERED = path.join(ROOT, "prisma", "amazon-discovered.json");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

type Product = {
  asin: string;
  category: string;
  title: string;
  brand: string;
  image: string;
  images: string[];
  price: number;
  originalPrice: number;
  rating: number;
  reviewCount: number;
  featured?: boolean;
  flash?: boolean;
};

function decode(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string) {
  const m =
    html.match(/<span id="productTitle"[^>]*>\s*([^<]+?)\s*<\/span>/) ||
    html.match(/<title>\s*(?:Amazon\.com\s*:\s*)?([^<|]+?)\s*(?:[|:]\s*Amazon\.com)?\s*<\/title>/);
  if (!m?.[1]) return null;
  const t = decode(m[1]);
  if (/page not found|robot check|sorry/i.test(t)) return null;
  return t.slice(0, 160);
}

function extractImage(html: string) {
  const patterns = [
    /"hiRes":"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/,
    /property="og:image"\s+content="([^"]+)"/i,
    /(https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9+\-_%,.]{8,})/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]?.includes("/images/I/")) return m[1].replace(/\\u002F/g, "/");
  }
  return null;
}

function extractPrice(html: string) {
  const patterns = [
    /"priceAmount":\s*([0-9]+(?:\.[0-9]+)?)/,
    /class="a-offscreen">\$([0-9,]+\.?[0-9]*)</,
    /"displayPrice":"\$([0-9,]+\.?[0-9]*)"/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      const v = parseFloat(m[1].replace(/,/g, ""));
      if (v > 0 && v < 10000) return v;
    }
  }
  return null;
}

function extractList(html: string, price: number) {
  const m = html.match(/List Price[^$]*\$([0-9,]+\.?[0-9]*)/i);
  if (m?.[1]) {
    const v = parseFloat(m[1].replace(/,/g, ""));
    if (v > price) return v;
  }
  return price;
}

function extractRating(html: string) {
  const m = html.match(/([0-9.]+) out of 5 stars/);
  const v = m ? parseFloat(m[1]) : NaN;
  return Number.isFinite(v) && v > 0 && v <= 5 ? v : 4.5;
}

function extractReviews(html: string) {
  const m = html.match(/([0-9,]+)\s+(?:global )?ratings/i);
  const v = m ? parseInt(m[1].replace(/,/g, ""), 10) : NaN;
  return Number.isFinite(v) && v > 0 ? v : 100;
}

function extractBrand(html: string, title: string) {
  const m =
    html.match(/"brand":\s*"([^"]{2,40})"/) ||
    html.match(/Visit the ([^<]{2,40}) Store/i);
  if (m?.[1]) return decode(m[1]);
  return title.split(" ")[0];
}

function categorize(title: string) {
  if (/book|kindle|novel/i.test(title)) return "books";
  if (/sunglass|eyewear|optic/i.test(title)) return "clothing";
  if (
    /shirt|tee\b|hoodie|sweatshirt|jean|pant|dress|skirt|bra\b|underwear|boxer|sock|legging|jacket|coat|shoe|boot|sandal|beanie|hat\b|short\b|blouse|romper|onesie|bodysuit|pajama|linen pants|cargo|polo|camisole|cardigan|footwear|apparel|clothing/i.test(
      title,
    )
  ) {
    return "clothing";
  }
  if (/tool|drill|wrench|screwdriver/i.test(title)) return "tools";
  if (/kitchen|cook|blender|vacuum|home/i.test(title)) return "home-kitchen";
  if (/game|xbox|playstation|nintendo/i.test(title)) return "gaming";
  if (/beauty|serum|shampoo|makeup|skin/i.test(title)) return "beauty";
  if (/sport|fitness|yoga|dumbbell/i.test(title)) return "sports";
  if (/pet|dog|cat /i.test(title)) return "pet-supplies";
  if (/car |auto|tire/i.test(title)) return "automotive";
  return "electronics";
}

async function check(asin: string) {
  // Prefer mobile product page — desktop /dp/ is frequently captcha-blocked
  const urls = [
    `https://www.amazon.com/gp/aw/d/${asin}`,
    `https://www.amazon.com/dp/${asin}`,
  ];
  const headerSets = [
    {
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Accept-Language": "en-US,en;q=0.9",
    },
    {
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9",
    },
  ];

  let lastFail: "invalid" | "blocked" = "invalid";
  for (let i = 0; i < urls.length; i++) {
    const res = await fetch(urls[i], { headers: headerSets[i], redirect: "follow" });
    if (res.status === 404) {
      lastFail = "invalid";
      continue;
    }
    if (!res.ok) {
      lastFail = "blocked";
      continue;
    }
    const html = await res.text();
    if (/captcha|robot check|automated access/i.test(html.slice(0, 4000))) {
      lastFail = "blocked";
      continue;
    }
    if (/page not found|not a functioning page/i.test(html)) {
      lastFail = "invalid";
      continue;
    }
    const title =
      extractTitle(html) ||
      decode(
        html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1] ||
          html.match(/content="([^"]+)"\s+property="og:title"/i)?.[1] ||
          "",
      ).replace(/\s*:\s*Amazon\.com.*$/i, "").slice(0, 160) ||
      null;
    const image = extractImage(html);
    const price = extractPrice(html);
    if (!title || !image) {
      lastFail = "invalid";
      continue;
    }
    const p = price ?? 0;
    // Don't accept missing/placeholder price if another URL may have a real one
    if (!p) {
      lastFail = "invalid";
      continue;
    }
    return {
      status: "ok" as const,
      product: {
        asin,
        category: categorize(title),
        title,
        brand: extractBrand(html, title),
        image,
        images: [image],
        price: p,
        originalPrice: extractList(html, p),
        rating: extractRating(html),
        reviewCount: extractReviews(html),
        featured: true,
        flash: extractList(html, p) > p * 1.1,
      } satisfies Product,
    };
  }
  return { status: lastFail };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const prisma = new PrismaClient();
  const existing = new Set(
    (await prisma.product.findMany({ select: { asin: true } }))
      .map((p) => p.asin)
      .filter(Boolean) as string[],
  );

  let discovered: Product[] = [];
  try {
    discovered = JSON.parse(readFileSync(DISCOVERED, "utf8"));
  } catch {
    /* empty */
  }

  const categories = await prisma.category.findMany();
  const bySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));

  const added: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  for (const asin of ASINS) {
    if (existing.has(asin)) {
      // Refresh listing with latest scrape so prices/images stay accurate
      console.log(`REFRESH ${asin}…`);
      await prisma.product.deleteMany({ where: { asin } });
      existing.delete(asin);
    }

    let result = await check(asin);
    if (result.status === "blocked") {
      console.log(`BLOCKED ${asin} — retrying…`);
      await sleep(10000);
      result = await check(asin);
    }
    if (result.status === "blocked") {
      console.log(`BLOCKED ${asin} — retrying again…`);
      await sleep(20000);
      result = await check(asin);
    }
    if (result.status !== "ok") {
      console.log(`FAIL  ${asin} (${result.status}${"reason" in result ? `: ${result.reason}` : ""})`);
      failed.push(asin);
      await sleep(2000);
      continue;
    }

    const cdn = normalizeProductImage(result.product.image);
    result.product.image = cdn;
    result.product.images = [cdn];

    if (!discovered.some((p) => p.asin === asin)) {
      discovered.push(result.product);
    }

    const category = bySlug[result.product.category] || bySlug.electronics;
    const discountPercent =
      result.product.originalPrice > result.product.price
        ? Math.round(
            ((result.product.originalPrice - result.product.price) / result.product.originalPrice) *
              1000,
          ) / 10
        : 0;

    await prisma.product.create({
      data: {
        asin,
        slug: `${slugify(result.product.title)}-${asin.toLowerCase()}`.slice(0, 180),
        title: result.product.title,
        description: `${result.product.title} — available on Amazon via DealForge.`,
        brand: result.product.brand,
        categoryId: category.id,
        subcategory:
          result.product.category === "clothing"
            ? inferClothingSubcategory(result.product.title, result.product.brand)
            : null,
        images: JSON.stringify(result.product.images),
        price: result.product.price,
        originalPrice: result.product.originalPrice,
        discountPercent,
        rating: result.product.rating,
        reviewCount: result.product.reviewCount,
        affiliateUrl: amazonDpLink(asin),
        retailer: "amazon",
        availability: "in_stock",
        specifications: JSON.stringify({
          Brand: result.product.brand,
          ASIN: asin,
          Retailer: "Amazon",
          ...(result.product.category === "clothing"
            ? {
                Department: inferClothingSubcategory(
                  result.product.title,
                  result.product.brand,
                ),
              }
            : {}),
        }),
        trendingScore: 90,
        clickCount: 0,
        viewCount: 0,
        isFeatured: true,
        isFlashDeal: Boolean(result.product.flash),
        flashEndsAt: result.product.flash
          ? new Date(Date.now() + 1000 * 60 * 60 * 24)
          : null,
        lastUpdated: new Date(),
      },
    });

    existing.add(asin);
    added.push(asin);
    console.log(
      `OK    ${asin}  $${result.product.price}  ${result.product.title.slice(0, 70)}`,
    );
    await sleep(2500);
  }

  writeFileSync(DISCOVERED, JSON.stringify(discovered, null, 2));
  console.log("\n=== Results ===");
  console.log(`added   : ${added.length}`, added);
  console.log(`skipped : ${skipped.length}`, skipped);
  console.log(`failed  : ${failed.length}`, failed);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
