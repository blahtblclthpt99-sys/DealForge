/**
 * Verify candidate ASINs against live Amazon product pages.
 * - 200 + real title + image  → verified, image downloaded, added to prisma/amazon-discovered.json
 * - 404                       → invalid ASIN, dropped
 * - 503 / captcha / block     → retried with backoff (multiple passes)
 * Existing ASINs (base catalog + already discovered) are skipped — no doubles.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public", "products");
const DISCOVERED_FILE = path.join(ROOT, "prisma", "amazon-discovered.json");
const CATALOG_FILE = path.join(ROOT, "prisma", "amazon-catalog.json");

type Discovered = {
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

// Candidate ASINs for popular products. Titles are guesses only —
// the real title/brand/price are scraped from the live page.
const CANDIDATES: string[] = [
  // still blocked from last run — retrying
  "B07ZPKBL9V", // AirPods Pro
  "B0BDHWDR12", // AirPods Pro 2 USB-C
  "B084DWG2VQ", // Echo Dot 4th gen
  "B07PGL2ZSL", // Echo Show 5
  "B0B7BP6CJN",
  "B075X8871V",
  "B07W4DHKBD",
  "B01LSUQSB0", // Revlon One-Step hair dryer
  "B07DGR98VQ",
  "B00FZ0FK0U",
  "B000GAWSDG", // WD-40
  "B00JX1ZS5O",
  "B073V5T57K",
  "B00SMBFP0A", // Anker PowerLine
  "B07QR73T66", // Crest 3D Whitestrips
  "B0863TXGM3", // Sony WH-CH710N
  "B00X4WHP5E",
  "B08MQZXN1X",
  "B0009X29WK",
  "B00006IV0Q",
  "B07GBZ4Q68",
  "B01E6AO69U",
  "B07FKR1PP7",
];

// Confirmed dead ASINs from previous runs — never recheck
const KNOWN_INVALID = new Set([
  "B00KXULGJQ", "B085S45XPY", "B07B4L1PBS", "B076H3SRXG", "B071NJ2Z3D",
  "B004P4QFJM", "B00YQ6X8EO", "B01AKGRTUM", "B00UB9UJVK", "B08PZHYWJS",
  "B07H9DVLBB", "B08N5WRWNW", "B016V8YWNK", "B0794W1SKP", "B08J5F3G18",
  "B0BFC7WQ6R", "B00ZV9RDKK", "B0DLFMFBJW", // title/image mismatch on Amazon
]);

const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/headphone|earbud|airpod|speaker|echo|alexa|fire tv|roku|tablet|ipad|kindle|charger|cable|hdmi|usb|mouse|keyboard|monitor|camera|router|memory card|ssd|power bank|smart plug|smart bulb|streaming/i, "electronics"],
  [/game|gaming|xbox|playstation|nintendo|controller|console/i, "gaming"],
  [/skillet|cooker|pot|pan|kitchen|blender|air fryer|coffee|kettle|knife|vacuum|mop|sheet|pillow|towel|humidifier|purifier/i, "home-kitchen"],
  [/drill|wrench|screwdriver|tool|tape measure|flashlight|wd-40|lubricant|multimeter|saw/i, "tools"],
  [/car |automotive|tire|dash cam|jump starter|motor oil|windshield/i, "automotive"],
  [/shirt|sock|legging|jacket|shoe|boot|hat|jean/i, "clothing"],
  [/serum|moisturizer|shampoo|makeup|whitestrip|lipstick|sunscreen|hair dryer|straightener|beauty/i, "beauty"],
  [/dog|cat |pet |leash|litter|aquarium/i, "pet-supplies"],
  [/notebook|pen |stapler|desk|office|printer|paper shredder/i, "office"],
  [/tent|camping|hiking|grill|cooler|fishing|backpack/i, "outdoor"],
  [/dumbbell|yoga|resistance band|treadmill|fitness|scale|protein/i, "sports"],
  [/toy|lego|puzzle|doll|board game/i, "toys"],
  [/snack|coffee bean|tea |pantry|grocery/i, "grocery"],
  [/book|novel|paperback|hardcover/i, "books"],
];

function categorize(title: string) {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(title)) return cat;
  return "electronics";
}

function loadJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string) {
  const m =
    html.match(/<span id="productTitle"[^>]*>\s*([^<]+?)\s*<\/span>/) ||
    html.match(/<title>\s*(?:Amazon\.com\s*:\s*)?([^<|]+?)\s*(?:[|:]\s*Amazon\.com)?\s*<\/title>/);
  if (!m?.[1]) return null;
  const t = decodeEntities(m[1]);
  if (/^amazon\.com/i.test(t) || /page not found|robot check|sorry/i.test(t)) return null;
  return t.slice(0, 140);
}

function extractImage(html: string) {
  const patterns = [
    /"hiRes":"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/,
    /property="og:image"\s+content="([^"]+)"/i,
    /"large":"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/,
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

function extractListPrice(html: string, price: number) {
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

function extractReviewCount(html: string) {
  const m = html.match(/([0-9,]+)\s+(?:global )?ratings/i);
  const v = m ? parseInt(m[1].replace(/,/g, ""), 10) : NaN;
  return Number.isFinite(v) && v > 0 ? v : 1000;
}

function extractBrand(html: string, title: string) {
  const m =
    html.match(/"brand":\s*"([^"]{2,40})"/) ||
    html.match(/Visit the ([^<]{2,40}) Store/i) ||
    html.match(/Brand<\/span>[^>]*>\s*<[^>]*>\s*([^<]{2,40})</i);
  if (m?.[1]) return decodeEntities(m[1]);
  return title.split(" ")[0];
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

type FetchResult =
  | { status: "ok"; product: Discovered }
  | { status: "invalid" }
  | { status: "blocked" };

async function checkAsin(asin: string): Promise<FetchResult> {
  let res: Response;
  try {
    res = await fetch(`https://www.amazon.com/dp/${asin}`, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
      redirect: "follow",
    });
  } catch {
    return { status: "blocked" };
  }

  if (res.status === 404) return { status: "invalid" };
  if (res.status === 503 || res.status === 429 || !res.ok) return { status: "blocked" };

  const html = await res.text();
  if (/captcha|robot check|automated access/i.test(html.slice(0, 4000))) {
    return { status: "blocked" };
  }
  if (/page not found|the web address you entered is not a functioning page/i.test(html)) {
    return { status: "invalid" };
  }

  const title = extractTitle(html);
  const image = extractImage(html);
  if (!title || !image) return { status: "invalid" };

  const price = extractPrice(html) ?? 0;
  if (price === 0) return { status: "invalid" }; // unavailable / no buy box — skip

  const originalPrice = extractListPrice(html, price);
  const product: Discovered = {
    asin,
    category: categorize(title),
    title,
    brand: extractBrand(html, title),
    image,
    images: [image],
    price,
    originalPrice,
    rating: extractRating(html),
    reviewCount: extractReviewCount(html),
    flash: originalPrice > price * 1.15,
  };
  return { status: "ok", product };
}

async function downloadImage(asin: string, url: string) {
  const dest = path.join(OUT_DIR, `${asin}.jpg`);
  if (existsSync(dest)) return `/products/${asin}.jpg`;
  const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!r.ok || !r.body) return null;
  const type = r.headers.get("content-type") || "";
  if (!type.includes("image")) return null;
  // @ts-expect-error Node fetch body is a web stream
  await pipeline(Readable.fromWeb(r.body), createWriteStream(dest));
  return `/products/${asin}.jpg`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const catalog = loadJson<Array<{ asin: string }>>(CATALOG_FILE, []);
  const discovered = loadJson<Discovered[]>(DISCOVERED_FILE, []);
  const existing = new Set([
    ...catalog.map((p) => p.asin.split(/-X|-GAME|-BEAU|-SOCK|-AUTO|-HOME/)[0]),
    ...discovered.map((p) => p.asin),
  ]);

  let queue = CANDIDATES.filter((a) => !existing.has(a) && !KNOWN_INVALID.has(a));
  console.log(`Checking ${queue.length} candidate ASINs (${existing.size} already in catalog)`);

  const verified: Discovered[] = [];
  const invalid: string[] = [];
  const MAX_PASSES = 6;

  for (let pass = 1; pass <= MAX_PASSES && queue.length; pass++) {
    console.log(`\n— pass ${pass} (${queue.length} to check) —`);
    const retry: string[] = [];

    for (const asin of queue) {
      const result = await checkAsin(asin);
      if (result.status === "ok") {
        const local = await downloadImage(asin, result.product.image);
        if (local) {
          result.product.image = local;
          result.product.images = [local];
          verified.push(result.product);
          console.log(`OK      ${asin}  $${result.product.price}  ${result.product.title.slice(0, 60)}`);
        } else {
          console.log(`NOIMG   ${asin}  (image download failed, will retry)`);
          retry.push(asin);
        }
      } else if (result.status === "invalid") {
        invalid.push(asin);
        console.log(`INVALID ${asin}`);
      } else {
        retry.push(asin);
        console.log(`BLOCKED ${asin}  (will retry)`);
      }
      await sleep(4000 + Math.random() * 4000);
    }

    queue = retry;
    if (queue.length && pass < MAX_PASSES) {
      const backoff = 30000 * pass;
      console.log(`backing off ${backoff / 1000}s before next pass…`);
      await sleep(backoff);
    }
  }

  const merged = [...discovered, ...verified];
  writeFileSync(DISCOVERED_FILE, JSON.stringify(merged, null, 2));

  console.log(`\n=== Results ===`);
  console.log(`verified & added : ${verified.length}`);
  console.log(`invalid ASINs    : ${invalid.length}${invalid.length ? ` (${invalid.join(", ")})` : ""}`);
  console.log(`still blocked    : ${queue.length}${queue.length ? ` (${queue.join(", ")})` : ""}`);
  console.log(`total discovered : ${merged.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
