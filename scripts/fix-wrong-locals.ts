import { existsSync, unlinkSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { normalizeProductImage } from "../src/lib/product-image";

/** Known-good CDN images for curated ASINs whose local files were wrong fallbacks. */
const FIXES: Record<string, string> = {
  B0DLFMFBJW: "https://m.media-amazon.com/images/I/61SUj2aKoEL._AC_SL1500_.jpg",
  B00ZV9RDKK: "https://m.media-amazon.com/images/I/81uKwM1s2nL._AC_SL1500_.jpg",
  B0BFC7WQ6R: "https://m.media-amazon.com/images/I/61uAGmWrCAL._AC_SL1500_.jpg",
  B08L5M9BTJ: "https://m.media-amazon.com/images/I/41iWogJnZQL._AC_SL1000_.jpg",
};

async function main() {
  const prisma = new PrismaClient();
  for (const [asin, url] of Object.entries(FIXES)) {
    const img = normalizeProductImage(url);
    const local = path.join(process.cwd(), "public", "products", `${asin}.jpg`);
    if (existsSync(local)) {
      unlinkSync(local);
      console.log("deleted bad local", asin);
    }
    const n = await prisma.product.updateMany({
      where: { asin },
      data: { images: JSON.stringify([img]) },
    });
    console.log("db", asin, n.count, img.slice(0, 70));
  }

  // Patch amazon-catalog.json too so reseeds stay correct
  const catalogPath = path.join(process.cwd(), "prisma", "amazon-catalog.json");
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as Array<{
    asin: string;
    image: string;
    images?: string[];
  }>;
  for (const p of catalog) {
    if (FIXES[p.asin]) {
      const img = normalizeProductImage(FIXES[p.asin]);
      p.image = img;
      p.images = [img];
    }
  }
  writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
  await prisma.cacheEntry.deleteMany();
  await prisma.$disconnect();
  console.log("done");
}

main();
