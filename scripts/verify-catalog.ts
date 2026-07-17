import { PrismaClient } from "@prisma/client";
import { existsSync, statSync } from "fs";
import path from "path";

async function main() {
  const p = new PrismaClient();
  const total = await p.product.count();
  const amazon = await p.product.count({ where: { retailer: "amazon" } });
  const ebay = await p.product.count({ where: { retailer: "ebay" } });
  const aliexpress = await p.product.count({ where: { retailer: "aliexpress" } });
  const rows = await p.product.findMany({
    select: { title: true, images: true, retailer: true },
  });

  let local = 0;
  let http = 0;
  let svg = 0;
  let missingFiles = 0;

  for (const r of rows) {
    const imgs = JSON.parse(r.images || "[]") as string[];
    const first = imgs[0] || "";
    if (first.startsWith("/products/")) {
      local += 1;
      const file = path.join(process.cwd(), "public", first.replace(/^\//, ""));
      if (!existsSync(file) || statSync(file).size < 1000) missingFiles += 1;
    } else if (first.startsWith("http")) http += 1;
    else if (first.startsWith("data:")) svg += 1;
  }

  console.log({
    total,
    amazon,
    ebay,
    aliexpress,
    images: { local, http, svg, missingFiles },
    sample: rows
      .filter((r) => r.retailer !== "amazon")
      .slice(0, 4)
      .map((r) => ({
        retailer: r.retailer,
        title: r.title.slice(0, 40),
        img: JSON.parse(r.images)[0],
      })),
  });
  await p.$disconnect();
}

main();
