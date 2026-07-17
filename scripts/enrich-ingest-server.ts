/**
 * Local ingest server: browser POSTs scraped Amazon rows here; we write DB.
 *   npx tsx scripts/enrich-ingest-server.ts
 *   POST http://127.0.0.1:3847/enrich  JSON array of scraped products
 *   GET  http://127.0.0.1:3847/status
 */
import { createServer } from "http";
import { appendFileSync, writeFileSync, readFileSync, existsSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { slugify } from "../src/lib/utils";
import { normalizeProductImage } from "../src/lib/product-image";
import { inferClothingSubcategory } from "../src/lib/clothing-subcategory";

const PORT = 3847;
const prisma = new PrismaClient();
const LOG = "prisma/enrich-results.jsonl";

type Row = {
  asin: string;
  title?: string;
  brand?: string;
  price?: number;
  originalPrice?: number;
  image?: string;
  rating?: number;
  reviewCount?: number;
  unavailable?: boolean;
  err?: string;
};

const stats = { received: 0, updated: 0, skipped: 0, unavailable: 0, errors: 0 };
let clothingId: string | undefined;
const idByAsin = new Map<string, string>();

async function loadQueue() {
  if (!existsSync("prisma/enrich-queue.json")) return;
  const queue = JSON.parse(readFileSync("prisma/enrich-queue.json", "utf8")) as Array<{
    id: string;
    asin: string;
  }>;
  for (const q of queue) idByAsin.set(q.asin.toUpperCase(), q.id);
  console.log(`Loaded queue map: ${idByAsin.size}`);
}

async function applyRows(rows: Row[]) {
  if (!clothingId) {
    clothingId = (await prisma.category.findFirst({ where: { slug: "clothing" } }))?.id;
  }
  for (const row of rows) {
    stats.received++;
    const asin = (row.asin || "").toUpperCase();
    const id = idByAsin.get(asin);
    if (!id) {
      stats.skipped++;
      continue;
    }
    appendFileSync(LOG, JSON.stringify(row) + "\n");

    if (row.unavailable) {
      await prisma.product.update({
        where: { id },
        data: { availability: "unavailable", lastUpdated: new Date() },
      });
      stats.unavailable++;
      idByAsin.delete(asin);
      continue;
    }
    if (row.err || !row.title || !(row.price && row.price >= 1 && row.price < 5000)) {
      stats.errors++;
      continue;
    }

    const title = row.title
      .replace(/^Amazon\.com\s*[|:]\s*/i, "")
      .replace(/&amp;/g, "&")
      .replace(/&#39;|&apos;|&#x27;/gi, "'")
      .trim()
      .slice(0, 180);
    const brand = (row.brand || "Coach").slice(0, 60);
    const price = row.price;
    let original = row.originalPrice && row.originalPrice > price ? row.originalPrice : price;
    if (original > price * 2.5) original = price;
    const discount =
      original > price ? Math.round(((original - price) / original) * 1000) / 10 : 0;
    const image = row.image ? normalizeProductImage(row.image) : "";
    const existing = await prisma.product.findUnique({ where: { id }, select: { images: true } });
    const imgs = image ? [image] : (JSON.parse(existing?.images || "[]") as string[]);

    const slugBase = slugify(title).slice(0, 50) || asin.toLowerCase();
    let slug = `${slugBase}-${asin.toLowerCase()}`.slice(0, 180);
    let n = 2;
    while (await prisma.product.findFirst({ where: { slug, NOT: { id } } })) {
      slug = `${slugBase}-${asin.toLowerCase()}-${n++}`.slice(0, 180);
    }

    await prisma.product.update({
      where: { id },
      data: {
        title,
        description: `${title} — available on Amazon via DealForge.`,
        brand,
        slug,
        images: JSON.stringify(imgs),
        price,
        originalPrice: original,
        discountPercent: discount,
        rating: row.rating && row.rating > 0 ? row.rating : 4.5,
        reviewCount: row.reviewCount && row.reviewCount > 0 ? row.reviewCount : 50,
        categoryId: clothingId,
        subcategory: inferClothingSubcategory(title, brand),
        availability: "in_stock",
        specifications: JSON.stringify({
          Brand: brand,
          ASIN: asin,
          Retailer: "Amazon",
          source: "user-batch",
          needsEnrichment: false,
          enrichedAt: new Date().toISOString(),
        }),
        lastUpdated: new Date(),
      },
    });
    stats.updated++;
    idByAsin.delete(asin);
    if (stats.updated % 25 === 0) {
      console.log(`updated=${stats.updated} leftInMap=${idByAsin.size}`);
    }
  }
  // Persist remaining queue
  const left = [...idByAsin.entries()].map(([asin, id]) => ({ id, asin }));
  writeFileSync("prisma/enrich-queue.json", JSON.stringify(left));
}

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ...stats, queueLeft: idByAsin.size }));
    return;
  }
  if (req.method === "GET" && req.url === "/queue") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([...idByAsin.keys()]));
    return;
  }
  if (req.method === "POST" && req.url === "/enrich") {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const rows: Row[] = Array.isArray(body) ? body : body.rows || [];
      await applyRows(rows);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...stats, queueLeft: idByAsin.size }));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

async function start() {
  await loadQueue();
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Enrich ingest listening on http://127.0.0.1:${PORT}`);
  });
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
