import { PrismaClient } from "@prisma/client";

const FIXES: Record<string, string> = {
  B0DLFMFBJW: "https://m.media-amazon.com/images/I/61SUj2aKoEL._AC_SL1500_.jpg",
  B00ZV9RDKK: "https://m.media-amazon.com/images/I/81uKwM1s2nL._AC_SL1500_.jpg",
  B0BFC7WQ6R: "https://m.media-amazon.com/images/I/61uAGmWrCAL._AC_SL1500_.jpg",
  B08L5M9BTJ: "https://m.media-amazon.com/images/I/41iWogJnZQL._AC_SL1000_.jpg",
};

async function main() {
  for (const [asin, url] of Object.entries(FIXES)) {
    try {
      const r = await fetch(url, { method: "HEAD" });
      console.log(asin, r.status, r.headers.get("content-type"));
    } catch (e) {
      console.log(asin, "ERR", (e as Error).message);
    }
  }
  const p = new PrismaClient();
  for (const [asin, url] of Object.entries(FIXES)) {
    await p.product.updateMany({
      where: { asin },
      data: { images: JSON.stringify([url]) },
    });
  }
  await p.cacheEntry.deleteMany();
  console.log("updated");
  await p.$disconnect();
}

main();
