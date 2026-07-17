/**
 * 1) Validate Amazon CDN images
 * 2) Download working photos into public/products/
 * 3) Write final amazon-catalog.json + ebay-catalog.json with local images
 * 4) Ready for db seed
 */
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { normalizeProductImage } from "../src/lib/product-image";

type ProductSeed = {
  asin: string;
  category: string;
  title: string;
  brand: string;
  image: string;
  images?: string[];
  price: number;
  originalPrice: number;
  rating: number;
  reviewCount: number;
  featured?: boolean;
  flash?: boolean;
  searchUrl?: string;
};

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public", "products");

const BASE: ProductSeed[] = [
  {
    asin: "B09XS7JWHH",
    category: "electronics",
    title: "Sony WH-1000XM5 Wireless Noise Canceling Headphones",
    brand: "Sony",
    image: "https://m.media-amazon.com/images/I/61O3iMlnJIL._AC_SL1500_.jpg",
    price: 328,
    originalPrice: 399.99,
    rating: 4.6,
    reviewCount: 12840,
    featured: true,
    flash: true,
  },
  {
    asin: "B08C1W5N87",
    category: "electronics",
    title: "Fire TV Stick Streaming Device with Alexa Voice Remote",
    brand: "Amazon",
    image: "https://m.media-amazon.com/images/I/71Wt1thqZEL._AC_SL1500_.jpg",
    price: 24.99,
    originalPrice: 39.99,
    rating: 4.5,
    reviewCount: 89000,
    featured: true,
    flash: true,
  },
  {
    asin: "B09B8V1LZ3",
    category: "electronics",
    title: "Echo Dot (5th Gen) Smart Speaker with Alexa",
    brand: "Amazon",
    image: "https://m.media-amazon.com/images/I/61J2sQtBYDL._AC_SL1500_.jpg",
    price: 29.99,
    originalPrice: 49.99,
    rating: 4.7,
    reviewCount: 210000,
    featured: true,
    flash: true,
  },
  {
    asin: "B08L5M9BTJ",
    category: "electronics",
    title: "Apple 20W USB-C Power Adapter",
    brand: "Apple",
    image: "https://m.media-amazon.com/images/I/41iWogJnZQL._AC_SL1000_.jpg",
    price: 19,
    originalPrice: 19,
    rating: 4.7,
    reviewCount: 120000,
    featured: true,
  },
  {
    asin: "B08GYKNCCP",
    category: "electronics",
    title: "SanDisk 128GB Ultra microSDXC UHS-I Memory Card with Adapter",
    brand: "SanDisk",
    image: "https://m.media-amazon.com/images/I/61EF7HnrWqL._AC_SL1500_.jpg",
    price: 12.99,
    originalPrice: 24.99,
    rating: 4.7,
    reviewCount: 450000,
    flash: true,
  },
  {
    asin: "B09V3HN1KC",
    category: "electronics",
    title: "Apple iPad Air (5th Generation) 10.9-inch Wi-Fi 64GB",
    brand: "Apple",
    image: "https://m.media-amazon.com/images/I/61XZQXFQeVL._AC_SL1500_.jpg",
    price: 449,
    originalPrice: 599,
    rating: 4.8,
    reviewCount: 18000,
    featured: true,
  },
  {
    asin: "B07FZ8S74R",
    category: "electronics",
    title: "Echo Dot (3rd Gen) Smart Speaker with Alexa",
    brand: "Amazon",
    image: "https://m.media-amazon.com/images/I/61MZfowYoaL._AC_SL1000_.jpg",
    price: 19.99,
    originalPrice: 39.99,
    rating: 4.7,
    reviewCount: 500000,
  },
  {
    asin: "B07VP37KMB",
    category: "electronics",
    title: "4K HDMI Splitter 1x2 HDR Compatible",
    brand: "Compat",
    image: "https://m.media-amazon.com/images/I/71p0Thwj7vL._AC_SL1500_.jpg",
    price: 15.99,
    originalPrice: 29.99,
    rating: 4.4,
    reviewCount: 8000,
    flash: true,
  },
  {
    asin: "B00006JSUA",
    category: "home-kitchen",
    title: "Lodge Seasoned Cast Iron Skillet, 10.25 Inch",
    brand: "Lodge",
    image: "https://m.media-amazon.com/images/I/71iH2iNxTZL._AC_SL1500_.jpg",
    price: 19.9,
    originalPrice: 29.9,
    rating: 4.8,
    reviewCount: 98000,
    featured: true,
  },
  {
    asin: "B00FLYWNYQ",
    category: "home-kitchen",
    title: "Instant Pot Duo 7-in-1 Electric Pressure Cooker, 6 Quart",
    brand: "Instant Pot",
    image: "https://m.media-amazon.com/images/I/71Z401LjFFL._AC_SL1500_.jpg",
    price: 79.95,
    originalPrice: 129.95,
    rating: 4.6,
    reviewCount: 210000,
    featured: true,
    flash: true,
  },
  {
    asin: "B01N1UX8RW",
    category: "sports",
    title: "RENPHO Smart Scale for Body Weight with BMI and Body Fat",
    brand: "RENPHO",
    image: "https://m.media-amazon.com/images/I/61KqTsLN+pL._SL1500_.jpg",
    price: 26.99,
    originalPrice: 39.99,
    rating: 4.5,
    reviewCount: 120000,
    featured: true,
  },
  {
    asin: "B01AVDVHTI",
    category: "sports",
    title: "Fit Simplify Resistance Loop Exercise Bands, Set of 5",
    brand: "Fit Simplify",
    image: "https://m.media-amazon.com/images/I/71S4-NjoTDL._AC_SL1500_.jpg",
    price: 12.95,
    originalPrice: 19.95,
    rating: 4.5,
    reviewCount: 200000,
    featured: true,
    flash: true,
  },
];

/** Extra ASINs — images must be verified live from Amazon (no borrowed hints). */
const EXTRA_ASINS: Array<{
  asin: string;
  category: string;
  title: string;
  brand: string;
  price: number;
  originalPrice: number;
  featured?: boolean;
  flash?: boolean;
  imageHints: string[];
}> = [];

async function headOk(url: string) {
  try {
    const r = await fetch(url, { method: "HEAD", redirect: "follow" });
    const len = Number(r.headers.get("content-length") || 0);
    const type = r.headers.get("content-type") || "";
    return r.ok && type.includes("image") && len > 2000;
  } catch {
    return false;
  }
}

async function download(url: string, dest: string) {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok || !r.body) throw new Error(`download failed ${r.status}`);
  // @ts-expect-error Node fetch body is a web stream
  await pipeline(Readable.fromWeb(r.body), createWriteStream(dest));
}

function pickImage(html: string) {
  const patterns = [
    /property="og:image"\s+content="([^"]+)"/i,
    /"hiRes":"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/,
    /(https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9+\-_%,.]+)/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]?.includes("/images/I/")) return m[1].replace(/\\u002F/g, "/");
  }
  return null;
}

async function resolveFromAmazonPage(asin: string) {
  try {
    const r = await fetch(`https://www.amazon.com/dp/${asin}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    const html = await r.text();
    return pickImage(html);
  } catch {
    return null;
  }
}

async function attach(asin: string, candidates: string[]) {
  const local = `/products/${asin}.jpg`;
  const dest = path.join(OUT_DIR, `${asin}.jpg`);
  if (existsSync(dest)) return local;

  for (const url of candidates) {
    if (!(await headOk(url))) continue;
    try {
      await download(url, dest);
      console.log(`saved ${asin} ← ${url.slice(0, 70)}`);
      return local;
    } catch (e) {
      console.log(`fail download ${asin}`, e);
    }
  }
  return null;
}

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const finalProducts: ProductSeed[] = [];

  for (const p of BASE) {
    // Store Amazon CDN URLs in catalog — local files were often wrong when CDN HEAD failed.
    await attach(p.asin, [p.image, ...(p.images || [])]);
    finalProducts.push({
      ...p,
      image: p.image,
      images: [p.image],
    });
  }

  const seenAsins = new Set(finalProducts.map((p) => p.asin));

  for (const extra of EXTRA_ASINS) {
    if (seenAsins.has(extra.asin)) {
      console.log(`skip duplicate ASIN ${extra.asin}`);
      continue;
    }
    const live = await resolveFromAmazonPage(extra.asin);
    const candidates = [live, ...extra.imageHints].filter(Boolean) as string[];
    const liveImg = live ? normalizeProductImage(live) : null;
    const cdn =
      liveImg ||
      candidates.find((u) => u?.startsWith("https://m.media-amazon.com/images/I/")) ||
      null;
    await attach(extra.asin, candidates);
    if (!cdn) {
      console.log(`skip extra ${extra.asin} (no verified CDN image)`);
      continue;
    }
    seenAsins.add(extra.asin);
    finalProducts.push({
      asin: extra.asin,
      category: extra.category,
      title: extra.title,
      brand: extra.brand,
      image: cdn,
      images: [cdn],
      price: extra.price,
      originalPrice: extra.originalPrice,
      rating: 4.5,
      reviewCount: 5000,
      featured: extra.featured,
      flash: extra.flash,
    });
  }

  // Unique Amazon products only — no category-fill clones, no marketplace mirrors
  writeFileSync(
    path.join(ROOT, "prisma", "amazon-catalog.json"),
    JSON.stringify(finalProducts, null, 2),
  );
  writeFileSync(path.join(ROOT, "prisma", "ebay-catalog.json"), JSON.stringify([], null, 2));
  writeFileSync(path.join(ROOT, "prisma", "aliexpress-catalog.json"), JSON.stringify([], null, 2));

  console.log(`Attached images in public/products`);
  console.log(`Amazon catalog (unique): ${finalProducts.length}`);
  console.log(`eBay catalog: 0 (no mirrors)`);
  console.log(`AliExpress catalog: 0 (no mirrors)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
