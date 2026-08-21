import { PrismaClient } from "@prisma/client";
import { existsSync, statSync } from "fs";
import path from "path";

const prisma = new PrismaClient();

function parseStringArray(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? (parsed as string[])
      : null;
  } catch {
    return null;
  }
}

function parseObject(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function safeAffiliateUrl(raw: string) {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443")
    );
  } catch {
    return false;
  }
}

async function main() {
  const rows = await prisma.product.findMany({
    select: {
      id: true,
      asin: true,
      title: true,
      images: true,
      retailer: true,
      affiliateUrl: true,
      price: true,
      originalPrice: true,
      discountPercent: true,
      specifications: true,
    },
  });

  const retailerCounts = new Map<string, number>();
  const listingKeys = new Set<string>();
  const duplicateListings: string[] = [];
  const malformedImageJson: string[] = [];
  const malformedSpecifications: string[] = [];
  const noUsableImage: string[] = [];
  const missingLocalImages: string[] = [];
  const invalidCommerce: string[] = [];
  const unsafeAffiliateUrls: string[] = [];
  let storefrontBlocked = 0;
  let needsEnrichment = 0;
  let localImages = 0;
  let remoteImages = 0;
  let dataImages = 0;

  for (const row of rows) {
    retailerCounts.set(row.retailer, (retailerCounts.get(row.retailer) ?? 0) + 1);

    if (row.asin) {
      const key = `${row.retailer.toLowerCase()}::${row.asin.toUpperCase()}`;
      if (listingKeys.has(key)) duplicateListings.push(key);
      else listingKeys.add(key);
    }

    const specs = parseObject(row.specifications);
    if (!specs) malformedSpecifications.push(row.id);
    else {
      if (specs.storefrontBlocked === true) storefrontBlocked++;
      if (specs.needsEnrichment === true) needsEnrichment++;
    }

    const images = parseStringArray(row.images);
    if (!images) {
      malformedImageJson.push(row.id);
    } else {
      const first = images.find((image) => image.trim()) ?? "";
      if (!first) {
        noUsableImage.push(row.id);
      } else if (first.startsWith("/")) {
        localImages++;
        const file = path.join(process.cwd(), "public", first.replace(/^\/+/, ""));
        if (!existsSync(file) || statSync(file).size < 100) missingLocalImages.push(row.id);
      } else if (first.startsWith("https://")) {
        remoteImages++;
      } else if (first.startsWith("data:")) {
        dataImages++;
      } else {
        noUsableImage.push(row.id);
      }
    }

    if (
      !Number.isFinite(row.price) ||
      row.price <= 0 ||
      !Number.isFinite(row.originalPrice) ||
      row.originalPrice < row.price ||
      !Number.isFinite(row.discountPercent) ||
      row.discountPercent < 0 ||
      row.discountPercent > 100
    ) {
      invalidCommerce.push(row.id);
    }

    if (!safeAffiliateUrl(row.affiliateUrl)) unsafeAffiliateUrls.push(row.id);
  }

  const summary = {
    total: rows.length,
    publicCandidates: rows.length - storefrontBlocked - needsEnrichment,
    storefrontBlocked,
    needsEnrichment,
    retailers: Object.fromEntries(
      [...retailerCounts.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ),
    images: {
      local: localImages,
      remote: remoteImages,
      data: dataImages,
      malformedJson: malformedImageJson.length,
      noUsableImage: noUsableImage.length,
      missingLocalFiles: missingLocalImages.length,
    },
    invariants: {
      duplicateRetailerListingIds: duplicateListings.length,
      malformedSpecifications: malformedSpecifications.length,
      invalidCommerceRows: invalidCommerce.length,
      unsafeAffiliateUrls: unsafeAffiliateUrls.length,
    },
    samples: {
      duplicateListings: duplicateListings.slice(0, 10),
      malformedImageJson: malformedImageJson.slice(0, 10),
      missingLocalImages: missingLocalImages.slice(0, 10),
      invalidCommerce: invalidCommerce.slice(0, 10),
      unsafeAffiliateUrls: unsafeAffiliateUrls.slice(0, 10),
    },
  };

  console.log(JSON.stringify(summary, null, 2));

  const hardFailures =
    duplicateListings.length +
    malformedImageJson.length +
    malformedSpecifications.length +
    noUsableImage.length +
    missingLocalImages.length +
    invalidCommerce.length +
    unsafeAffiliateUrls.length;

  if (hardFailures) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
