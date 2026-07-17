import { PrismaClient } from "@prisma/client";
import { normalizeProductImage } from "../src/lib/product-image";

const prisma = new PrismaClient();
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function extractImage(html: string) {
  const patterns = [
    /"hiRes":"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/,
    /property="og:image"\s+content="([^"]+)"/i,
    /(https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9+\-_%,.]{8,})/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]?.includes("/images/I/")) return m[1].replace(/\\u002F/g, "/");
  }
  return null;
}

async function probeUrl(url: string) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": UA },
      redirect: "follow",
    });
    if (!res.ok) return false;
    const ct = res.headers.get("content-type") || "";
    const len = Number(res.headers.get("content-length") || "0");
    // tiny / html responses are usually broken
    if (ct.includes("text/html")) return false;
    if (len > 0 && len < 800) return false;
    return true;
  } catch {
    return false;
  }
}

async function scrapeImage(asin: string) {
  const urls = [
    `https://www.amazon.com/gp/aw/d/${asin}`,
    `https://www.amazon.com/dp/${asin}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
        redirect: "follow",
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (/captcha|robot check|automated access/i.test(html.slice(0, 4000))) continue;
      const img = extractImage(html);
      if (img) return normalizeProductImage(img);
    } catch {
      /* try next */
    }
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isBlankImage(imagesJson: string) {
  let list: string[] = [];
  try {
    list = JSON.parse(imagesJson || "[]") as string[];
  } catch {
    list = [];
  }
  const img = (list[0] || "").trim();
  if (!img || !list.length) return true;
  if (img.includes("placeholder")) return true;
  return false;
}

async function main() {
  const named = await prisma.product.findMany({
    where: {
      OR: [
        { title: { contains: "Leafigure" } },
        { title: { contains: "Comfort Colors" } },
        { asin: { in: ["B0DNMJ694B", "B07M989JLF"] } },
      ],
    },
    select: { id: true, asin: true, title: true, images: true },
  });
  console.log("Named products:");
  for (const n of named) {
    console.log(n.asin, n.images, n.title.slice(0, 60));
  }

  const all = await prisma.product.findMany({
    select: { id: true, asin: true, title: true, images: true },
  });

  const blank = all.filter((r) => isBlankImage(r.images));
  console.log(`\nBlank/placeholder images: ${blank.length}`);

  // Also check recently added fashion ASINs that may have broken CDN URLs
  const recentAsins = [
    "B0DNMJ694B",
    "B07M989JLF",
    "B086KSDTQ4",
    "B0F6VKZ4FB",
    "B00D1ARZMC",
    "B0FP5BYXVR",
    "B07JCS8NRC",
    "B0FBGGCYR4",
    "B0FS1DBXTG",
    "B075ZZ7XKD",
    "B0FTSRNCNF",
    "B0FLQKYQLM",
    "B0BV241H3F",
    "B07HNWNXMK",
    "B09MKNL9M3",
    "B0DSVVJBRK",
    "B0FNC4GM8V",
    "B0CKZ4ZWYG",
    "B0BHXB24QW",
  ];

  const suspects = await prisma.product.findMany({
    where: {
      OR: [
        { id: { in: blank.map((b) => b.id) } },
        { asin: { in: recentAsins } },
        { images: { contains: "/images/P/" } },
        { images: { contains: "placeholder" } },
      ],
    },
    select: { id: true, asin: true, title: true, images: true },
  });

  // Dedupe
  const byId = new Map(suspects.map((s) => [s.id, s]));
  const list = [...byId.values()];
  console.log(`Suspects to check: ${list.length}`);

  let fixed = 0;
  let removed = 0;
  let ok = 0;

  for (const row of list) {
    const current = (() => {
      try {
        return (JSON.parse(row.images || "[]") as string[])[0] || "";
      } catch {
        return "";
      }
    })();

    const blankish = isBlankImage(row.images);
    let liveOk = false;
    if (!blankish && current.startsWith("http")) {
      liveOk = await probeUrl(current);
    } else if (!blankish && current.startsWith("/")) {
      // local path — treat as ok if not placeholder
      liveOk = !current.includes("placeholder");
    }

    if (liveOk) {
      ok += 1;
      continue;
    }

    if (!row.asin) {
      await prisma.product.delete({ where: { id: row.id } });
      removed += 1;
      console.log("REMOVED (no asin)", row.title.slice(0, 55));
      continue;
    }

    console.log(`FIX? ${row.asin} ${row.title.slice(0, 50)}`);
    const scraped = await scrapeImage(row.asin);
    if (scraped && !scraped.includes("placeholder")) {
      const good = await probeUrl(scraped);
      if (good || scraped.includes("/images/I/")) {
        await prisma.product.update({
          where: { id: row.id },
          data: { images: JSON.stringify([scraped]) },
        });
        fixed += 1;
        console.log("  FIXED", scraped.slice(0, 70));
        await sleep(1800);
        continue;
      }
    }

    // Do not delete — leave placeholder so catalog stays intact; retry later.
    console.log("  SKIP (no image yet)");
    await sleep(1200);
  }

  await prisma.cacheEntry.deleteMany({
    where: { key: { startsWith: "products:" } },
  });

  const left = await prisma.product.count({
    where: {
      OR: [{ images: { contains: "placeholder" } }, { images: { equals: "[]" } }, { images: { equals: "" } }],
    },
  });

  console.log("\n=== Results ===");
  console.log({ ok, fixed, removed, placeholdersLeft: left });
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
