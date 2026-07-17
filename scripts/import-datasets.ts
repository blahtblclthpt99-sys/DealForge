/**
 * Bulk-import real Amazon products from public datasets:
 *  1. prisma/data/amazon-products.csv  (Bright Data sample, ~1000 products)
 *  2. prisma/data/amazon-books.csv     (Bright Data popular books, ~2200 books)
 *  3. Hugging Face Amazon-Reviews-2023 raw product metadata (tops up to TARGET)
 *
 * Every product must have: valid ASIN, title, Amazon CDN image, price > 0.
 * Deduped against the existing catalog and within itself. Output: prisma/amazon-bulk.json
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { parse } from "csv-parse/sync";

const ROOT = process.cwd();
const TARGET = Number(process.env.IMPORT_TARGET || 5000);
const OUT_FILE = path.join(ROOT, "prisma", "amazon-bulk.json");

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

const ASIN_RE = /^(B0[A-Z0-9]{8}|\d{9}[\dX])$/;
const CDN_RE = /^https:\/\/(m\.media-amazon\.com|images-na\.ssl-images-amazon\.com)\//;

const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/book|kindle|literature|magazine/i, "books"],
  [/electronic|computer|camera|photo|cell phone|headphone|audio|tv|video game console accessor|wearable/i, "electronics"],
  [/video game|gaming|playstation|xbox|nintendo/i, "gaming"],
  [/home|kitchen|furniture|appliance|bedding|bath|vacuum/i, "home-kitchen"],
  [/tool|home improvement|industrial|hardware/i, "tools"],
  [/automotive|motorcycle|vehicle/i, "automotive"],
  [/clothing|shoe|jewelry|fashion|apparel|watch/i, "clothing"],
  [/beauty|personal care|skin|hair|makeup|fragrance/i, "beauty"],
  [/pet/i, "pet-supplies"],
  [/office|stationery/i, "office"],
  [/patio|lawn|garden|outdoor|camping|hiking/i, "outdoor"],
  [/sport|fitness|exercise|athletic/i, "sports"],
  [/toy|game|puzzle|baby|kids/i, "toys"],
  [/grocery|gourmet|food|snack|beverage|health|household|vitamin/i, "grocery"],
];

function categorize(...hints: Array<string | undefined>) {
  const text = hints.filter(Boolean).join(" ");
  for (const [re, cat] of CATEGORY_RULES) if (re.test(text)) return cat;
  return "electronics";
}

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v !== "string") return 0;
  const n = parseFloat(v.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function clean(s: string) {
  return s.replace(/\s+/g, " ").trim().slice(0, 160);
}

function loadCsv(file: string): Record<string, string>[] {
  const full = path.join(ROOT, file);
  if (!existsSync(full)) {
    console.log(`missing ${file} — skipping`);
    return [];
  }
  return parse(readFileSync(full), {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
  }) as Record<string, string>[];
}

function fromBrightDataRow(r: Record<string, string>): Product | null {
  const asin = (r.asin || "").trim().toUpperCase();
  if (!ASIN_RE.test(asin)) return null;
  const title = clean(r.title || "");
  const image = ((r.image_url || r.image || "").trim().split(/[\s|]/)[0] || "").trim();
  if (!title || title.length < 4 || !CDN_RE.test(image)) return null;

  const price = num(r.final_price);
  const initial = num(r.initial_price);
  if (price <= 0 || price > 20000) return null;

  const rating = Math.min(5, Math.max(0, num(r.rating)));
  const reviews = Math.max(0, Math.round(num(r.reviews_count)));
  let cats = "";
  try {
    const parsed = JSON.parse(r.categories || "[]");
    if (Array.isArray(parsed)) cats = parsed.join(" ");
  } catch {
    cats = r.categories || "";
  }

  return {
    asin,
    category: categorize(cats, r.department, title),
    title,
    brand: clean(r.brand || r.manufacturer || title.split(" ")[0]).slice(0, 60) || "Amazon",
    image,
    images: [image],
    price,
    originalPrice: initial > price ? initial : price,
    rating: rating || 4.2,
    reviewCount: reviews || 50,
    flash: initial > price * 1.15,
  };
}

type HfMetaRow = {
  parent_asin?: string;
  title?: string;
  price?: string | number | null;
  average_rating?: number;
  rating_number?: number;
  store?: string;
  main_category?: string;
  images?: Array<{ hi_res?: string | null; large?: string | null; thumb?: string | null }>;
};

const HF_CATEGORIES = [
  "Electronics",
  "Home_and_Kitchen",
  "Tools_and_Home_Improvement",
  "Automotive",
  "Video_Games",
  "Clothing_Shoes_and_Jewelry",
  "Beauty_and_Personal_Care",
  "Pet_Supplies",
  "Office_Products",
  "Patio_Lawn_and_Garden",
  "Sports_and_Outdoors",
  "Toys_and_Games",
  "Grocery_and_Gourmet_Food",
  "Cell_Phones_and_Accessories",
  "Health_and_Household",
  "Appliances",
  "Musical_Instruments",
  "Baby_Products",
];

function hfRowToProduct(row: HfMetaRow, config: string): Product | null {
  const asin = (row.parent_asin || "").trim().toUpperCase();
  if (!ASIN_RE.test(asin)) return null;
  const title = clean(row.title || "");
  if (!title || title.length < 4) return null;
  const img = row.images?.[0];
  const image = img?.hi_res || img?.large || img?.thumb;
  if (!image || !CDN_RE.test(image)) return null;
  const price = num(row.price);
  if (price <= 0 || price > 20000) return null;
  const rating = Math.min(5, Math.max(0, num(row.average_rating)));
  return {
    asin,
    category: categorize(row.main_category, config, title),
    title,
    brand: clean(row.store || title.split(" ")[0]).slice(0, 60) || "Amazon",
    image,
    images: [image],
    price,
    originalPrice: price,
    rating: rating || 4.2,
    reviewCount: Math.max(0, Math.round(num(row.rating_number))) || 25,
  };
}

/**
 * Stream the raw JSONL metadata file for a category and stop as soon as we
 * collect `want` usable products — files are multi-GB so we must abort early.
 */
async function streamHfCategory(
  category: string,
  want: number,
  add: (p: Product | null) => boolean,
): Promise<number> {
  const url = `https://huggingface.co/datasets/McAuley-Lab/Amazon-Reviews-2023/resolve/main/raw/meta_categories/meta_${category}.jsonl`;
  const controller = new AbortController();
  let added = 0;
  let scanned = 0;
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!res.ok || !res.body) {
      console.log(`  ${category}: HTTP ${res.status}`);
      return 0;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const MAX_SCAN = 60000; // safety cap per category

    while (added < want && scanned < MAX_SCAN) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        scanned++;
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line) as HfMetaRow;
          if (add(hfRowToProduct(row, category))) added++;
        } catch {
          /* partial/corrupt line */
        }
        if (added >= want || scanned >= MAX_SCAN) break;
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") console.log(`  ${category}: ${(e as Error).message}`);
  } finally {
    controller.abort();
  }
  console.log(`  ${category}: +${added} (scanned ${scanned} rows)`);
  return added;
}

async function main() {
  const existing = new Set<string>();
  for (const file of ["prisma/amazon-catalog.json", "prisma/amazon-discovered.json"]) {
    try {
      const items = JSON.parse(readFileSync(path.join(ROOT, file), "utf8")) as Array<{ asin: string }>;
      for (const p of items) existing.add(p.asin.split(/-X|-GAME|-BEAU|-SOCK|-AUTO|-HOME/)[0]);
    } catch {
      /* file may not exist */
    }
  }

  const products = new Map<string, Product>();
  const add = (p: Product | null) => {
    if (p && !existing.has(p.asin) && !products.has(p.asin)) products.set(p.asin, p);
  };

  console.log("Parsing Bright Data products CSV…");
  for (const row of loadCsv("prisma/data/amazon-products.csv")) add(fromBrightDataRow(row));
  const afterProducts = products.size;
  console.log(`  usable: ${afterProducts}`);

  console.log("Parsing Bright Data books CSV…");
  for (const row of loadCsv("prisma/data/amazon-books.csv")) add(fromBrightDataRow(row));
  console.log(`  usable: ${products.size - afterProducts}`);

  console.log(`Total from CSVs: ${products.size} (target ${TARGET})`);

  if (products.size < TARGET) {
    console.log("Topping up from Hugging Face Amazon-Reviews-2023 raw metadata…");
    const addTracked = (p: Product | null) => {
      const before = products.size;
      add(p);
      return products.size > before;
    };
    const perCategory = Math.ceil((TARGET - products.size) / HF_CATEGORIES.length);
    for (const category of HF_CATEGORIES) {
      if (products.size >= TARGET) break;
      const want = Math.min(perCategory + 50, TARGET - products.size);
      await streamHfCategory(category, want, addTracked);
    }
  }

  const list = [...products.values()].slice(0, TARGET);
  // Flag some deals for the UI
  list.forEach((p, i) => {
    if (p.originalPrice === p.price && i % 6 === 0) {
      p.originalPrice = Math.round(p.price * (1.15 + (i % 4) * 0.1) * 100) / 100;
      p.flash = i % 12 === 0;
    }
    if (i % 40 === 0) p.featured = true;
  });

  writeFileSync(OUT_FILE, JSON.stringify(list, null, 1));

  const byCat: Record<string, number> = {};
  for (const p of list) byCat[p.category] = (byCat[p.category] || 0) + 1;
  console.log(`\nWrote ${list.length} unique products → prisma/amazon-bulk.json`);
  console.log("By category:", byCat);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
