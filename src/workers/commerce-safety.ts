import { checkDirectCommerceProductSafety } from "../lib/commerce-runtime-safety";
import { prisma } from "../lib/db";
import { isFinancialGateCertified } from "../lib/financial-gate";
import { parseJson } from "../lib/utils";

const CURSOR_KEY = "commerce-safety:cursor:v1";
const CURSOR_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_SCAN_LIMIT = 500;
const MAX_SCAN_LIMIT = 1_000;

type SafetyProduct = Awaited<ReturnType<typeof activeBatch>>[number];

export type CommerceSafetyResult = {
  activeBefore: number;
  scanned: number;
  quarantined: number;
  safe: number;
  concurrentChanges: number;
  reasons: Record<string, number>;
};

async function readCursor() {
  const entry = await prisma.cacheEntry.findUnique({ where: { key: CURSOR_KEY } });
  if (!entry || entry.expiresAt.getTime() <= Date.now()) return null;
  const value = entry.value.trim();
  return value || null;
}

async function writeCursor(value: string | null) {
  if (!value) {
    await prisma.cacheEntry.deleteMany({ where: { key: CURSOR_KEY } });
    return;
  }
  await prisma.cacheEntry.upsert({
    where: { key: CURSOR_KEY },
    create: {
      key: CURSOR_KEY,
      value,
      expiresAt: new Date(Date.now() + CURSOR_TTL_MS),
    },
    update: {
      value,
      expiresAt: new Date(Date.now() + CURSOR_TTL_MS),
    },
  });
}

async function activeBatch(cursor: string | null, limit: number) {
  const select = {
    id: true,
    retailer: true,
    affiliateUrl: true,
    asin: true,
    availability: true,
    currency: true,
    landedCostCents: true,
    sellingPriceCents: true,
    commerceEnabled: true,
    specifications: true,
  } as const;

  if (!cursor) {
    return prisma.product.findMany({
      where: { commerceEnabled: true },
      orderBy: { id: "asc" },
      take: limit,
      select,
    });
  }

  const after = await prisma.product.findMany({
    where: { commerceEnabled: true, id: { gt: cursor } },
    orderBy: { id: "asc" },
    take: limit,
    select,
  });
  if (after.length >= limit) return after;

  const beforeOrAt = await prisma.product.findMany({
    where: { commerceEnabled: true, id: { lte: cursor } },
    orderBy: { id: "asc" },
    take: limit - after.length,
    select,
  });
  return [...after, ...beforeOrAt];
}

async function quarantineProduct(product: SafetyProduct, reason: string, now: Date) {
  const specifications = parseJson<Record<string, unknown>>(product.specifications, {});
  const nextSpecifications = JSON.stringify({
    ...specifications,
    commerceAutoQuarantine: {
      status: "inactive",
      quarantinedAt: now.toISOString(),
      reason,
      automaticSupplierPurchasingEnabled: false,
    },
  });

  const write = await prisma.product.updateMany({
    where: {
      id: product.id,
      commerceEnabled: true,
      retailer: product.retailer,
      affiliateUrl: product.affiliateUrl,
      asin: product.asin,
      availability: product.availability,
      currency: product.currency,
      landedCostCents: product.landedCostCents,
      sellingPriceCents: product.sellingPriceCents,
      specifications: product.specifications,
    },
    data: {
      commerceEnabled: false,
      specifications: nextSpecifications,
    },
  });

  if (write.count !== 1) return false;

  await prisma.systemLog.create({
    data: {
      level: "warn",
      source: "commerce-safety",
      message: `Automatically quarantined direct commerce for ${product.id}`,
      meta: JSON.stringify({
        productId: product.id,
        reason,
        quarantinedAt: now.toISOString(),
        automaticSupplierPurchasingEnabled: false,
      }),
    },
  });
  return true;
}

export async function quarantineUnsafeDirectCommerce(
  limit = DEFAULT_SCAN_LIMIT,
): Promise<CommerceSafetyResult> {
  const safeLimit = Math.min(MAX_SCAN_LIMIT, Math.max(1, Math.trunc(limit)));
  const activeBefore = await prisma.product.count({ where: { commerceEnabled: true } });
  if (!activeBefore) {
    await writeCursor(null);
    return {
      activeBefore: 0,
      scanned: 0,
      quarantined: 0,
      safe: 0,
      concurrentChanges: 0,
      reasons: {},
    };
  }

  const cursor = await readCursor();
  const products = await activeBatch(cursor, safeLimit);
  const now = new Date();
  const financialGateCertified = isFinancialGateCertified();
  const reasons: Record<string, number> = {};
  let quarantined = 0;
  let safe = 0;
  let concurrentChanges = 0;

  for (const product of products) {
    const safety = checkDirectCommerceProductSafety({
      financialGateCertified,
      commerceEnabled: product.commerceEnabled,
      availability: product.availability,
      currency: product.currency,
      landedCostCents: product.landedCostCents,
      sellingPriceCents: product.sellingPriceCents,
      specifications: product.specifications,
      retailer: product.retailer,
      sourceUrl: product.affiliateUrl,
      asin: product.asin,
      nowMs: now.getTime(),
    });

    if (safety.safe) {
      safe += 1;
      continue;
    }

    reasons[safety.reason] = (reasons[safety.reason] || 0) + 1;
    if (await quarantineProduct(product, safety.reason, now)) quarantined += 1;
    else concurrentChanges += 1;
  }

  await writeCursor(products.at(-1)?.id ?? null);

  if (quarantined > 0) {
    await prisma.cacheEntry.deleteMany({ where: { key: { startsWith: "products:" } } });
    await prisma.systemLog.create({
      data: {
        level: "warn",
        source: "commerce-safety",
        message: `Commerce safety scan quarantined ${quarantined}/${products.length} scanned product(s)`,
        meta: JSON.stringify({
          activeBefore,
          scanned: products.length,
          quarantined,
          safe,
          concurrentChanges,
          reasons,
        }),
      },
    });
  }

  return {
    activeBefore,
    scanned: products.length,
    quarantined,
    safe,
    concurrentChanges,
    reasons,
  };
}
