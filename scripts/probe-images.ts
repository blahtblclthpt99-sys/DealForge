import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36";

async function main() {
  const placeholders = await p.product.findMany({
    where: { images: { contains: "placeholder" } },
    select: { asin: true, title: true, images: true },
  });
  console.log("PLACEHOLDERS", placeholders.length);
  for (const r of placeholders) console.log(r.asin, r.title.slice(0, 70));

  const sample = await p.product.findMany({
    take: 50,
    orderBy: { viewCount: "desc" },
    select: { asin: true, title: true, images: true },
  });

  let ok = 0;
  let bad = 0;
  for (const r of sample) {
    const img = (JSON.parse(r.images || "[]") as string[])[0];
    if (!img || img.includes("placeholder")) {
      bad++;
      console.log("PLACEHOLDER_ROW", r.asin);
      continue;
    }
    try {
      const res = await fetch(img, {
        method: "HEAD",
        redirect: "follow",
        headers: { "User-Agent": UA },
      });
      const len = Number(res.headers.get("content-length") || 0);
      const ct = res.headers.get("content-type") || "";
      const good = res.ok && !ct.includes("html") && (len === 0 || len > 800);
      if (good) ok++;
      else {
        bad++;
        console.log("BAD", r.asin, res.status, ct, len, img.slice(0, 90));
      }
    } catch (e) {
      bad++;
      console.log("ERR", r.asin, String(e).slice(0, 100));
    }
  }
  console.log({ sampleOk: ok, sampleBad: bad });
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
