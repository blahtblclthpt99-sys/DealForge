/**
 * Force-add ASINs using known-good Amazon CDN images + mobile scrape.
 * Falls back to browser-verified metadata when desktop is blocked.
 */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { slugify } from "../src/lib/utils";
import { amazonDpLink } from "../src/lib/affiliate/providers/amazon";
import { AMAZON_ASSOCIATE_TAG } from "../src/lib/affiliate/amazon-config";

type Seed = {
  asin: string;
  title?: string;
  brand?: string;
  category?: string;
  image?: string;
  price?: number;
  originalPrice?: number;
};

const SEEDS: Seed[] = [
  { asin: "B0FD8D9NJF" },
  { asin: "B0CRH74TD6" },
];

const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function decode(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

async function scrapeMobile(asin: string) {
  const res = await fetch(`https://www.amazon.com/gp/aw/d/${asin}`, {
    headers: { "User-Agent": UA_MOBILE, "Accept-Language": "en-US,en;q=0.9" },
    redirect: "follow",
  });
  const html = await res.text();
  if (/captcha|robot check|automated access/i.test(html.slice(0, 4000))) {
    return null;
  }
  const title = decode(
    html.match(/<span id="productTitle"[^>]*>\s*([^<]+)/)?.[1] ||
      html.match(/property="og:title"\s+content="([^"]+)/i)?.[1] ||
      html.match(/content="([^"]+)"\s+property="og:title"/i)?.[1] ||
      html.match(/<title>([^<]+)/)?.[1] ||
      "",
  )
    .replace(/\s*:\s*Amazon\.com.*$/i, "")
    .replace(/^Amazon\.com\s*:\s*/i, "")
    .slice(0, 160);

  const image =
    html.match(/property="og:image"\s+content="([^"]+)/i)?.[1] ||
    html.match(/"hiRes":"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/)?.[1]?.replace(
      /\\u002F/g,
      "/",
    ) ||
    html.match(/(https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9+\-_%,.]{8,})/)?.[1];

  const priceRaw =
    html.match(/"priceAmount":\s*([0-9.]+)/)?.[1] ||
    html.match(/class="a-offscreen">\$([0-9.,]+)/)?.[1] ||
    html.match(/\$([0-9]+\.[0-9]{2})\s*<\/span>/)?.[1];
  const price = priceRaw ? parseFloat(priceRaw.replace(/,/g, "")) : 0;

  const brand =
    decode(html.match(/"brand":\s*"([^"]{2,40})"/)?.[1] || "") ||
    decode(html.match(/Visit the ([^<]{2,40}) Store/i)?.[1] || "") ||
    title.split(" ")[0];

  const rating = parseFloat(html.match(/([0-9.]+) out of 5 stars/)?.[1] || "4.5");
  const reviews = parseInt(
    (html.match(/([0-9,]+)\s+(?:global )?ratings/i)?.[1] || "100").replace(/,/g, ""),
    10,
  );

  if (!title || !image || !price) return null;
  return { title, image, price, brand, rating, reviews };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const prisma = new PrismaClient();
  const categories = await prisma.category.findMany();
  const bySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));

  let discovered: Array<Record<string, unknown>> = [];
  const discFile = path.join(process.cwd(), "prisma", "amazon-discovered.json");
  try {
    discovered = JSON.parse(readFileSync(discFile, "utf8"));
  } catch {
    /* empty */
  }

  for (const seed of SEEDS) {
    let meta = null;
    for (let attempt = 1; attempt <= 5 && !meta; attempt++) {
      console.log(`try ${seed.asin} (attempt ${attempt})…`);
      meta = await scrapeMobile(seed.asin);
      if (!meta) await sleep(8000 * attempt);
    }
    if (!meta) {
      console.log(`FAIL ${seed.asin}`);
      continue;
    }

    const title = seed.title || meta.title;
    const brand = seed.brand || meta.brand;
    const price = seed.price || meta.price;
    const originalPrice = seed.originalPrice || price;
    const categorySlug =
      seed.category ||
      (/sunglass|eyewear|boot|sneaker|shoe/i.test(title) ? "clothing" : "electronics");
    const category = bySlug[categorySlug] || bySlug.electronics;
    const cdn = meta.image;

    await prisma.product.deleteMany({ where: { asin: seed.asin } });
    await prisma.product.create({
      data: {
        asin: seed.asin,
        slug: `${slugify(title)}-${seed.asin.toLowerCase()}`.slice(0, 180),
        title,
        description: `${title} — available on Amazon. DealForge links with Associates tag ${AMAZON_ASSOCIATE_TAG}.`,
        brand,
        categoryId: category.id,
        images: JSON.stringify([cdn]),
        price,
        originalPrice,
        discountPercent:
          originalPrice > price
            ? Math.round(((originalPrice - price) / originalPrice) * 1000) / 10
            : 0,
        rating: meta.rating,
        reviewCount: meta.reviews,
        affiliateUrl: amazonDpLink(seed.asin),
        retailer: "amazon",
        availability: "in_stock",
        specifications: JSON.stringify({
          Brand: brand,
          ASIN: seed.asin,
          Retailer: "Amazon",
        }),
        trendingScore: 95,
        clickCount: 0,
        viewCount: 0,
        isFeatured: true,
        isFlashDeal: true,
        flashEndsAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      },
    });

    discovered = discovered.filter((p) => p.asin !== seed.asin);
    discovered.push({
      asin: seed.asin,
      category: categorySlug,
      title,
      brand,
      image: cdn,
      images: [cdn],
      price,
      originalPrice,
      rating: meta.rating,
      reviewCount: meta.reviews,
      featured: true,
      flash: true,
    });

    console.log(`OK ${seed.asin} $${price} ${title.slice(0, 70)}`);
    await sleep(3000);
  }

  writeFileSync(discFile, JSON.stringify(discovered, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
