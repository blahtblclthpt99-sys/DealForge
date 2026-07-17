/** One-shot: point amazon-catalog.json at CDN URLs instead of wrong local /products paths. */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { normalizeProductImage } from "../src/lib/product-image";

const file = path.join(process.cwd(), "prisma", "amazon-catalog.json");
const catalog = JSON.parse(readFileSync(file, "utf8")) as Array<{
  asin: string;
  image?: string;
  images?: string[];
}>;

for (const p of catalog) {
  const cdn = [p.image, ...(p.images || [])].find((u) => u?.startsWith("https://"));
  if (cdn) {
    const img = normalizeProductImage(cdn);
    p.image = img;
    p.images = [img];
  }
}

writeFileSync(file, JSON.stringify(catalog, null, 2));
console.log(`Patched ${catalog.length} catalog entries to CDN URLs`);
