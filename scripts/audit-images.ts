import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const rows = await p.product.findMany({ select: { images: true, asin: true } });
  let empty = 0;
  let placeholder = 0;
  let local = 0;
  let pSlash = 0;
  let cdn = 0;
  let other = 0;
  const samples: Record<string, string[]> = {
    empty: [],
    placeholder: [],
    local: [],
    pSlash: [],
    other: [],
  };

  for (const r of rows) {
    let img = "";
    try {
      img = (JSON.parse(r.images || "[]") as string[])[0] || "";
    } catch {
      img = "";
    }
    if (!img) {
      empty++;
      if (samples.empty.length < 3) samples.empty.push(String(r.asin));
    } else if (img.includes("placeholder")) {
      placeholder++;
      if (samples.placeholder.length < 3) samples.placeholder.push(img);
    } else if (img.startsWith("/products/") || img.startsWith("/images/")) {
      local++;
      if (samples.local.length < 3) samples.local.push(img);
    } else if (img.includes("/images/P/")) {
      pSlash++;
      if (samples.pSlash.length < 3) samples.pSlash.push(img);
    } else if (/media-amazon|ssl-images-amazon|ebayimg|walmartimages/.test(img)) {
      cdn++;
    } else {
      other++;
      if (samples.other.length < 3) samples.other.push(img);
    }
  }

  console.log({ total: rows.length, empty, placeholder, local, pSlash, cdn, other, samples });
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
