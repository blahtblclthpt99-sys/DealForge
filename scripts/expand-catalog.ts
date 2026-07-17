/**
 * Expand catalog: fetch Amazon titles + real CDN images for many ASINs.
 * Writes prisma/amazon-catalog.json with only entries that have /images/I/ photos.
 */
import { writeFileSync } from "fs";
import path from "path";

type Row = {
  asin: string;
  category: string;
  title: string;
  brand: string;
  image: string;
  price: number;
  originalPrice: number;
  rating: number;
  reviewCount: number;
  featured?: boolean;
  flash?: boolean;
};

const CANDIDATES: Array<{
  asin: string;
  category: string;
  price: number;
  originalPrice: number;
  featured?: boolean;
  flash?: boolean;
}> = [
  // Electronics
  { asin: "B09XS7JWHH", category: "electronics", price: 328, originalPrice: 399.99, featured: true, flash: true },
  { asin: "B08C1W5N87", category: "electronics", price: 24.99, originalPrice: 39.99, featured: true, flash: true },
  { asin: "B09B8V1LZ3", category: "electronics", price: 29.99, originalPrice: 49.99, featured: true, flash: true },
  { asin: "B08L5M9BTJ", category: "electronics", price: 19, originalPrice: 19, featured: true },
  { asin: "B08GYKNCCP", category: "electronics", price: 12.99, originalPrice: 24.99, flash: true },
  { asin: "B09V3HN1KC", category: "electronics", price: 449, originalPrice: 599, featured: true },
  { asin: "B07FZ8S74R", category: "electronics", price: 19.99, originalPrice: 39.99 },
  { asin: "B07VP37KMB", category: "electronics", price: 15.99, originalPrice: 29.99, flash: true },
  { asin: "B0BSHF7WHW", category: "electronics", price: 89.99, originalPrice: 129.99, featured: true },
  { asin: "B0BDHB9Y8H", category: "electronics", price: 139.99, originalPrice: 159.99, featured: true },
  { asin: "B09G9FPHY6", category: "electronics", price: 169, originalPrice: 179, featured: true },
  { asin: "B08PPDJWCX", category: "electronics", price: 89, originalPrice: 99, flash: true },
  { asin: "B0C1H26C1P", category: "electronics", price: 34.99, originalPrice: 49.99 },
  { asin: "B09B8V3L8J", category: "electronics", price: 49.99, originalPrice: 79.99, flash: true },
  // Home
  { asin: "B00006JSUA", category: "home-kitchen", price: 19.9, originalPrice: 29.9, featured: true },
  { asin: "B00FLYWNYQ", category: "home-kitchen", price: 79.95, originalPrice: 129.95, featured: true, flash: true },
  { asin: "B08CFSZLQF", category: "home-kitchen", price: 49.9, originalPrice: 69.9 },
  { asin: "B07Y6YKKYF", category: "home-kitchen", price: 39.99, originalPrice: 69.99, featured: true },
  { asin: "B08L7XG9MK", category: "home-kitchen", price: 29.99, originalPrice: 49.99, flash: true },
  { asin: "B09N3ZNHTY", category: "home-kitchen", price: 24.99, originalPrice: 39.99 },
  // Tools
  { asin: "B08GKZ3X9K", category: "tools", price: 99, originalPrice: 149, featured: true, flash: true },
  { asin: "B07GXZ7R65", category: "tools", price: 39.97, originalPrice: 59.99 },
  { asin: "B08GYKNCCQ", category: "tools", price: 54.99, originalPrice: 89.99 },
  { asin: "B07YWWXFVC", category: "tools", price: 89.99, originalPrice: 149.99, featured: true },
  // Automotive
  { asin: "B07S9H4QTF", category: "automotive", price: 29.95, originalPrice: 39.95, featured: true },
  { asin: "B08L5M9BTK", category: "automotive", price: 19.99, originalPrice: 34.99, flash: true },
  { asin: "B09B8YRMT4", category: "automotive", price: 49.99, originalPrice: 79.99 },
  // Gaming
  { asin: "B08F7PTF54", category: "gaming", price: 49.99, originalPrice: 59.99, featured: true },
  { asin: "B0B7QJ6V8N", category: "gaming", price: 119.99, originalPrice: 159.99, flash: true },
  { asin: "B09V3HN1KD", category: "gaming", price: 69.99, originalPrice: 99.99 },
  // Clothing
  { asin: "B08CF3XY9C", category: "clothing", price: 49.99, originalPrice: 80, featured: true },
  { asin: "B07VP37KMC", category: "clothing", price: 24.99, originalPrice: 39.99 },
  // Beauty
  { asin: "B00I0B8B5A", category: "beauty", price: 16.48, originalPrice: 21.99, featured: true },
  { asin: "B01N1UX8RX", category: "beauty", price: 6, originalPrice: 7.5, flash: true },
  { asin: "B0CX23V2ZK", category: "beauty", price: 18.99, originalPrice: 28.99 },
  // Pet
  { asin: "B07VD9X67M", category: "pet-supplies", price: 49.99, originalPrice: 84.99, featured: true },
  { asin: "B08G4KN5GH", category: "pet-supplies", price: 29.99, originalPrice: 39.99 },
  // Office
  { asin: "B07S65MX2B", category: "office", price: 99.99, originalPrice: 119.99, featured: true },
  { asin: "B07YQK9Y8Z", category: "office", price: 22.99, originalPrice: 29.99 },
  // Outdoor
  { asin: "B07Q32B5XD", category: "outdoor", price: 79.99, originalPrice: 99.99, featured: true, flash: true },
  { asin: "B07PGL2WZQ", category: "outdoor", price: 39.95, originalPrice: 49.95 },
  { asin: "B0CR4Y7K2G", category: "outdoor", price: 59.99, originalPrice: 99.99 },
  // Sports
  { asin: "B01N1UX8RW", category: "sports", price: 26.99, originalPrice: 39.99, featured: true },
  { asin: "B01AVDVHTI", category: "sports", price: 12.95, originalPrice: 19.95, featured: true, flash: true },
  { asin: "B07RX6G8ZG", category: "sports", price: 199, originalPrice: 299, featured: true },
  // Toys
  { asin: "B08GJ2Y4YQ", category: "toys", price: 39.99, originalPrice: 59.99, featured: true },
  { asin: "B09B8V1LZ4", category: "toys", price: 24.99, originalPrice: 39.99, flash: true },
  // Grocery
  { asin: "B00BW6LCP2", category: "grocery", price: 18.96, originalPrice: 24.99, featured: true },
  { asin: "B00XVYVKG1", category: "grocery", price: 21.99, originalPrice: 32.99 },
  // Books
  { asin: "B00XVYVKGY", category: "books", price: 13.79, originalPrice: 27, featured: true },
  { asin: "B09Y5YQZ7K", category: "books", price: 16.99, originalPrice: 28 },
];

/** Seed fallbacks with already-verified Amazon CDN images (used if live fetch fails). */
const VERIFIED: Record<string, { title: string; brand: string; image: string }> = {
  B09XS7JWHH: {
    title: "Sony WH-1000XM5 Wireless Noise Canceling Headphones",
    brand: "Sony",
    image: "https://m.media-amazon.com/images/I/61O3iMlnJIL._AC_SL1500_.jpg",
  },
  B08C1W5N87: {
    title: "Fire TV Stick Streaming Device with Alexa Voice Remote",
    brand: "Amazon",
    image: "https://m.media-amazon.com/images/I/71Wt1thqZEL._AC_SL1500_.jpg",
  },
  B09B8V1LZ3: {
    title: "Echo Dot (5th Gen) Smart Speaker with Alexa",
    brand: "Amazon",
    image: "https://m.media-amazon.com/images/I/61J2sQtBYDL._AC_SL1500_.jpg",
  },
  B08L5M9BTJ: {
    title: "Apple 20W USB-C Power Adapter",
    brand: "Apple",
    image: "https://m.media-amazon.com/images/I/41iWogJnZQL._AC_SL1000_.jpg",
  },
  B08GYKNCCP: {
    title: "SanDisk 128GB Ultra microSDXC UHS-I Memory Card with Adapter",
    brand: "SanDisk",
    image: "https://m.media-amazon.com/images/I/61EF7HnrWqL._AC_SL1500_.jpg",
  },
  B09V3HN1KC: {
    title: "Apple iPad Air (5th Generation) 10.9-inch Wi-Fi 64GB",
    brand: "Apple",
    image: "https://m.media-amazon.com/images/I/61XZQXFQeVL._AC_SL1500_.jpg",
  },
  B07FZ8S74R: {
    title: "Echo Dot (3rd Gen) Smart Speaker with Alexa",
    brand: "Amazon",
    image: "https://m.media-amazon.com/images/I/61MZfowYoaL._AC_SL1000_.jpg",
  },
  B07VP37KMB: {
    title: "4K HDMI Splitter 1x2 HDR Compatible",
    brand: "Compat",
    image: "https://m.media-amazon.com/images/I/71p0Thwj7vL._AC_SL1500_.jpg",
  },
  B00006JSUA: {
    title: "Lodge Seasoned Cast Iron Skillet, 10.25 Inch",
    brand: "Lodge",
    image: "https://m.media-amazon.com/images/I/71iH2iNxTZL._AC_SL1500_.jpg",
  },
  B00FLYWNYQ: {
    title: "Instant Pot Duo 7-in-1 Electric Pressure Cooker, 6 Quart",
    brand: "Instant Pot",
    image: "https://m.media-amazon.com/images/I/71Z401LjFFL._AC_SL1500_.jpg",
  },
  B01N1UX8RW: {
    title: "RENPHO Smart Scale for Body Weight with BMI and Body Fat",
    brand: "RENPHO",
    image: "https://m.media-amazon.com/images/I/61KqTsLN+pL._SL1500_.jpg",
  },
  B01AVDVHTI: {
    title: "Fit Simplify Resistance Loop Exercise Bands, Set of 5",
    brand: "Fit Simplify",
    image: "https://m.media-amazon.com/images/I/71S4-NjoTDL._AC_SL1500_.jpg",
  },
};

function pickImage(html: string) {
  const patterns = [
    /property="og:image"\s+content="([^"]+)"/i,
    /content="([^"]+)"\s+property="og:image"/i,
    /"hiRes":"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/,
    /"large":"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/,
    /(https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9+\-_%,.]+)/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]?.includes("/images/I/")) return m[1].replace(/\\u002F/g, "/");
  }
  return null;
}

function pickTitle(html: string) {
  const m =
    html.match(/property="og:title"\s+content="([^"]+)"/i) ||
    html.match(/content="([^"]+)"\s+property="og:title"/i);
  if (!m?.[1]) return null;
  return m[1]
    .replace(/&amp;/g, "&")
    .replace(/\s*[|:].*Amazon.*$/i, "")
    .replace(/^Amazon\.com:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pickBrand(html: string, title: string) {
  const m =
    html.match(/id="bylineInfo"[^>]*>\s*(?:Visit the|Brand:)\s*([^<]+)/i) ||
    html.match(/"brand"\s*:\s*"([^"]+)"/i);
  if (m?.[1]) return m[1].replace(/Store$/i, "").trim();
  return title.split(/\s+/)[0] || "Amazon";
}

async function imageOk(url: string) {
  try {
    const r = await fetch(url, { method: "HEAD", redirect: "follow" });
    const len = Number(r.headers.get("content-length") || 0);
    const type = r.headers.get("content-type") || "";
    return r.ok && type.includes("image") && len > 2000;
  } catch {
    return false;
  }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const out: Row[] = [];
  const seen = new Set<string>();

  for (const c of CANDIDATES) {
    if (seen.has(c.asin)) continue;
    seen.add(c.asin);

    let title: string | null = null;
    let brand = "Amazon";
    let image: string | null = null;

    try {
      const r = await fetch(`https://www.amazon.com/dp/${c.asin}`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
          Accept: "text/html",
        },
        redirect: "follow",
      });
      const html = await r.text();
      title = pickTitle(html);
      image = pickImage(html);
      if (title && !/page not found/i.test(title)) brand = pickBrand(html, title);
      else title = null;
      await sleep(400);
    } catch {
      // fall through to verified map
    }

    if ((!image || !(await imageOk(image))) && VERIFIED[c.asin]) {
      title = VERIFIED[c.asin].title;
      brand = VERIFIED[c.asin].brand;
      image = VERIFIED[c.asin].image;
    }

    if (!title || !image || !(await imageOk(image))) {
      console.log(`skip ${c.asin}`);
      continue;
    }

    out.push({
      asin: c.asin,
      category: c.category,
      title: title.slice(0, 160),
      brand,
      image,
      price: c.price,
      originalPrice: c.originalPrice,
      rating: Math.round((4.2 + Math.random() * 0.7) * 10) / 10,
      reviewCount: Math.floor(Math.random() * 80000) + 500,
      featured: c.featured,
      flash: c.flash,
    });
    console.log(`ok ${c.asin} → ${title.slice(0, 50)}`);
  }

  // Always include verified set even if candidates failed
  for (const [asin, v] of Object.entries(VERIFIED)) {
    if (out.some((r) => r.asin === asin)) continue;
    const c = CANDIDATES.find((x) => x.asin === asin);
    if (!c) continue;
    out.push({
      asin,
      category: c.category,
      title: v.title,
      brand: v.brand,
      image: v.image,
      price: c.price,
      originalPrice: c.originalPrice,
      rating: 4.6,
      reviewCount: 10000,
      featured: c.featured,
      flash: c.flash,
    });
  }

  const file = path.join(process.cwd(), "prisma", "amazon-catalog.json");
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`Wrote ${out.length} products with real Amazon images`);
}

main();
