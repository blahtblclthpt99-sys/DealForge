/** Quick fix: set curated product images to known CDN URLs from attach BASE. */
import { existsSync, unlinkSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { normalizeProductImage } from "../src/lib/product-image";

const CDN: Record<string, string> = {
  B09XS7JWHH: "https://m.media-amazon.com/images/I/61O3iMlnJIL._AC_SL1500_.jpg",
  B08C1W5N87: "https://m.media-amazon.com/images/I/71Wt1thqZEL._AC_SL1500_.jpg",
  B09B8V1LZ3: "https://m.media-amazon.com/images/I/61J2sQtBYDL._AC_SL1500_.jpg",
  B08L5M9BTJ: "https://m.media-amazon.com/images/I/41iWogJnZQL._AC_SL1000_.jpg",
  B08GYKNCCP: "https://m.media-amazon.com/images/I/61EF7HnrWqL._AC_SL1500_.jpg",
  B09V3HN1KC: "https://m.media-amazon.com/images/I/61XZQXFQeVL._AC_SL1500_.jpg",
  B07FZ8S74R: "https://m.media-amazon.com/images/I/61MZfowYoaL._AC_SL1000_.jpg",
  B07VP37KMB: "https://m.media-amazon.com/images/I/71p0Thwj7vL._AC_SL1500_.jpg",
  B00006JSUA: "https://m.media-amazon.com/images/I/71iH2iNxTZL._AC_SL1500_.jpg",
  B00FLYWNYQ: "https://m.media-amazon.com/images/I/71Z401LjFFL._AC_SL1500_.jpg",
  B01N1UX8RW: "https://m.media-amazon.com/images/I/61KqTsLN+pL._SL1500_.jpg",
  B01AVDVHTI: "https://m.media-amazon.com/images/I/71S4-NjoTDL._AC_SL1500_.jpg",
};

async function main() {
  const prisma = new PrismaClient();
  for (const [asin, url] of Object.entries(CDN)) {
    const img = normalizeProductImage(url);
    const n = await prisma.product.updateMany({
      where: { asin },
      data: { images: JSON.stringify([img]) },
    });
    const local = path.join(process.cwd(), "public", "products", `${asin}.jpg`);
    if (existsSync(local)) unlinkSync(local);
    console.log(asin, n.count, img.slice(0, 70));
  }
  await prisma.cacheEntry.deleteMany();
  await prisma.$disconnect();
}

main();
