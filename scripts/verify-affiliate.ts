import { PrismaClient } from "@prisma/client";
import {
  AMAZON_ASSOCIATE_TAG,
  buildAmazonProductUrl,
} from "../src/lib/affiliate/amazon-config";

const prisma = new PrismaClient();
const ASIN_RE = /^[A-Z0-9]{10}$/;

function isAmazonHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "amazon.com" || host.endsWith(".amazon.com");
}

async function main() {
  const rows = await prisma.product.findMany({
    where: { retailer: "amazon" },
    select: { id: true, asin: true, title: true, affiliateUrl: true },
  });

  const problems: Array<{ id: string; asin: string | null; reason: string; title: string }> = [];

  for (const row of rows) {
    const asin = row.asin?.trim().toUpperCase() ?? null;
    if (!asin || !ASIN_RE.test(asin)) {
      problems.push({ id: row.id, asin, reason: "invalid-or-missing-asin", title: row.title.slice(0, 70) });
      continue;
    }

    try {
      const url = new URL(row.affiliateUrl);
      if (url.protocol !== "https:" || !isAmazonHost(url.hostname)) {
        problems.push({ id: row.id, asin, reason: "invalid-amazon-destination", title: row.title.slice(0, 70) });
        continue;
      }
      if (!url.pathname.includes(`/dp/${asin}`)) {
        problems.push({ id: row.id, asin, reason: "asin-url-mismatch", title: row.title.slice(0, 70) });
      }
      if (url.searchParams.get("tag") !== AMAZON_ASSOCIATE_TAG) {
        problems.push({ id: row.id, asin, reason: "missing-or-wrong-associate-tag", title: row.title.slice(0, 70) });
      }
    } catch {
      problems.push({ id: row.id, asin, reason: "malformed-url", title: row.title.slice(0, 70) });
    }

    const rebuilt = new URL(buildAmazonProductUrl(asin));
    if (
      rebuilt.searchParams.get("tag") !== AMAZON_ASSOCIATE_TAG ||
      !rebuilt.pathname.includes(`/dp/${asin}`)
    ) {
      problems.push({ id: row.id, asin, reason: "link-builder-regression", title: row.title.slice(0, 70) });
    }
  }

  console.log(
    JSON.stringify(
      {
        amazonProducts: rows.length,
        associateTag: AMAZON_ASSOCIATE_TAG,
        valid: rows.length - problems.length,
        problems: problems.length,
        sampleProblems: problems.slice(0, 25),
      },
      null,
      2,
    ),
  );

  if (problems.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
