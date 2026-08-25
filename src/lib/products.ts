/**
 * Product query layer — DB-level pagination (never loads the full catalog).
 */
import { prisma } from "./db";
import { cacheGet, cacheSet } from "./cache";
import { generateAffiliateLink } from "./affiliate/registry";
import { computeRankScore } from "./ranking";
import { parseJson } from "./utils";
import { normalizeProductImage } from "./product-image";
import { parseQuantityFromTitle } from "./quantity";
import { evaluateCertificationCommerceGate, evaluateCommerceGate } from "./commerce-gate";
import { recommendCommercialPrice } from "./commercialization";
import { readStorefrontInventoryDecisions, type StorefrontInventoryDecision } from "./storefront-inventory";
import {
  CERTIFICATION_CATALOG_PRODUCT_IDS,
  certificationCatalogScopeKey,
  isCertificationCatalogMode,
  isCertificationCatalogProduct,
  isCertificationTransactionMode,
} from "./certification-catalog";
import {
  AMAZON_METADATA_MAX_AGE_MS,
  AMAZON_PRICE_MAX_AGE_MS,
  isAuthorizedAmazonMetadataSource,
  isAuthorizedAmazonPriceSource,
  isFreshVerification,
} from "./source-policy";
import type { Prisma } from "@prisma/client";

export type ProductDTO = {
  id: string;
  asin: string | null;
  slug: string;
  title: string;
  description: string;
  brand: string;
  categoryId: string;
  categorySlug?: string;
  categoryName?: string;
  subcategory: string | null;
  images: string[];
  quantity: number | null;
  price: number;
  originalPrice: number;
  discountPercent: number;
  priceEstimated: boolean;
  rating: number;
  reviewCount: number;
  affiliateUrl: string;
  retailer: string;
  availability: string;
  availabilityVerified: boolean;
  inventoryVerifiedAt: string | null;
  inventoryExpiresAt: string | null;
  priceVerified: boolean;
  metadataVerified: boolean;
  priceSource: string | null;
  priceVerifiedAt: string | null;
  metadataSource: string | null;
  metadataVerifiedAt: string | null;
  specifications: Record<string, string>;
  trendingScore: number;
  clickCount: number;
  viewCount: number;
  isFeatured: boolean;
  isFlashDeal: boolean;
  flashEndsAt: string | null;
  lastUpdated: string;
  createdAt: string;
  rankScore: number;
  purchaseMode: "direct" | "affiliate";
  commerceReady: boolean;
  currency: string;
};

const productListSelect = {
  id: true,
  asin: true,
  slug: true,
  title: true,
  description: true,
  brand: true,
  categoryId: true,
  category: { select: { slug: true, name: true } },
  subcategory: true,
  images: true,
  quantity: true,
  price: true,
  originalPrice: true,
  discountPercent: true,
  rating: true,
  reviewCount: true,
  affiliateUrl: true,
  retailer: true,
  availability: true,
  specifications: true,
  priceSource: true,
  priceVerifiedAt: true,
  metadataSource: true,
  metadataVerifiedAt: true,
  trendingScore: true,
  clickCount: true,
  viewCount: true,
  isFeatured: true,
  isFlashDeal: true,
  flashEndsAt: true,
  lastUpdated: true,
  createdAt: true,
  commerceEnabled: true,
  sellingPriceCents: true,
  landedCostCents: true,
  currency: true,
} satisfies Prisma.ProductSelect;

type ProductWithCategory = Prisma.ProductGetPayload<{ select: typeof productListSelect }>;

const RETAIL_PRICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const RETAIL_METADATA_MAX_AGE_MS = 48 * 60 * 60 * 1000;

function cleanImages(raw: string): string[] {
  const list = parseJson<string[]>(raw, []).filter(Boolean);
  const normalized = list.map((u) => normalizeProductImage(u)).filter((u) => u && !u.includes("placeholder"));
  return normalized.length ? Array.from(new Set(normalized)) : ["/images/placeholder-product.svg"];
}

function sanitizePricing(price: number, originalPrice: number, discountPercent: number) {
  const p = Number.isFinite(price) && price > 0 ? price : 0;
  let o = Number.isFinite(originalPrice) && originalPrice > 0 ? originalPrice : p;
  let d = Number.isFinite(discountPercent) ? discountPercent : 0;
  if (o < p) o = p;
  if (o > p * 2.5 || d >= 70 || (o >= 500 && d >= 50)) {
    o = p;
    d = 0;
  } else if (o > p) {
    d = Math.round(((o - p) / o) * 1000) / 10;
  } else d = 0;
  return { price: p, originalPrice: o, discountPercent: d };
}

const PRIVATE_SPECIFICATION_KEYS = new Set([
  "supplierOfferV1",
  "commerceV1",
  "internalCertification",
  "certificationCatalog",
  "certificationRole",
  "productEngine",
  "sourceType",
  "needsEnrichment",
]);

export function productClaimIntegrity(input: {
  retailer: string;
  priceSource: string | null;
  priceVerifiedAt: Date | null;
  metadataSource: string | null;
  metadataVerifiedAt: Date | null;
}, nowMs = Date.now()) {
  if (input.retailer === "amazon") {
    return {
      priceVerified: isAuthorizedAmazonPriceSource(input.priceSource)
        && isFreshVerification(input.priceVerifiedAt, AMAZON_PRICE_MAX_AGE_MS, nowMs),
      metadataVerified: isAuthorizedAmazonMetadataSource(input.metadataSource)
        && isFreshVerification(input.metadataVerifiedAt, AMAZON_METADATA_MAX_AGE_MS, nowMs),
    };
  }

  return {
    priceVerified: Boolean(
      input.priceSource?.trim()
      && isFreshVerification(input.priceVerifiedAt, RETAIL_PRICE_MAX_AGE_MS, nowMs),
    ),
    metadataVerified: Boolean(
      input.metadataSource?.trim()
      && isFreshVerification(input.metadataVerifiedAt, RETAIL_METADATA_MAX_AGE_MS, nowMs),
    ),
  };
}

export const amazonClaimIntegrity = productClaimIntegrity;

function publicSpecifications(raw: string) {
  const parsed = parseJson<Record<string, unknown>>(raw, {});
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (PRIVATE_SPECIFICATION_KEYS.has(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const label = key.trim().slice(0, 120);
      const text = String(value).trim().slice(0, 1000);
      if (label && text) safe[label] = text;
    }
  }
  return safe;
}

function directCommerceDecision(p: ProductWithCategory) {
  const certificationTransaction = isCertificationTransactionMode() && isCertificationCatalogProduct(p);
  if (!certificationTransaction && process.env.COMMERCE_ENABLED !== "true") return { allowed: false } as const;
  const input = {
    commerceEnabled: p.commerceEnabled,
    availability: p.availability,
    sellingPriceCents: p.sellingPriceCents,
    landedCostCents: p.landedCostCents,
    priceVerifiedAt: p.priceVerifiedAt,
    specifications: p.specifications,
  };
  return certificationTransaction
    ? evaluateCertificationCommerceGate(input)
    : evaluateCommerceGate(input);
}

function storefrontBindingInput(p: ProductWithCategory) {
  return {
    productId: p.id,
    currency: p.currency,
    availability: p.availability,
    landedCostCents: p.landedCostCents,
    priceVerifiedAt: p.priceVerifiedAt,
    specifications: p.specifications,
  };
}

async function toPublicProductDTOs(rows: ProductWithCategory[]) {
  let decisions = new Map<string, StorefrontInventoryDecision>();
  try {
    decisions = await readStorefrontInventoryDecisions(rows.map(storefrontBindingInput));
  } catch {
    // Inventory/source evidence is a promotion prerequisite. Read failures must
    // under-claim availability and direct-commerce readiness, never over-claim.
  }
  return rows.map((row) => toProductDTO(row, decisions.get(row.id) ?? null));
}

function dealForgeEstimatedPrice(referencePrice: number) {
  const referenceCents = Math.round(referencePrice * 100);
  if (!Number.isSafeInteger(referenceCents) || referenceCents <= 0) return 0;
  try {
    return recommendCommercialPrice({
      itemCostCents: referenceCents,
      shippingCents: 0,
      taxCents: 0,
      supplierFeeCents: 0,
      handlingCents: 0,
      acquisitionReserveCents: 0,
    }).recommendedPriceCents / 100;
  } catch {
    return 0;
  }
}

export function toProductDTO(
  p: ProductWithCategory,
  inventoryDecision: StorefrontInventoryDecision | null = null,
): ProductDTO {
  const images = cleanImages(p.images);
  const specs = publicSpecifications(p.specifications);
  const integrity = productClaimIntegrity({
    retailer: p.retailer,
    priceSource: p.priceSource,
    priceVerifiedAt: p.priceVerifiedAt,
    metadataSource: p.metadataSource,
    metadataVerifiedAt: p.metadataVerifiedAt,
  });
  const commerce = directCommerceDecision(p);
  const direct = commerce.allowed
    && inventoryDecision?.bindingAllowed === true
    && inventoryDecision.availabilityVerified
    && Number.isSafeInteger(p.sellingPriceCents)
    && (p.sellingPriceCents ?? 0) > 0;
  const rawPricing = sanitizePricing(p.price, p.originalPrice, p.discountPercent);
  const configuredPrice = Number.isSafeInteger(p.sellingPriceCents) && (p.sellingPriceCents ?? 0) > 0
    ? (p.sellingPriceCents as number) / 100
    : 0;
  const estimatedPrice = direct ? 0 : configuredPrice || dealForgeEstimatedPrice(rawPricing.price);
  const pricing = direct
    ? { price: configuredPrice, originalPrice: configuredPrice, discountPercent: 0 }
    : estimatedPrice > 0
      ? { price: estimatedPrice, originalPrice: estimatedPrice, discountPercent: 0 }
      : { price: 0, originalPrice: 0, discountPercent: 0 };
  const priceEstimated = !direct && estimatedPrice > 0;
  const rating = integrity.metadataVerified ? p.rating : 0;
  const reviewCount = integrity.metadataVerified ? p.reviewCount : 0;
  const availability = direct
    ? inventoryDecision.availability
    : integrity.metadataVerified
      ? p.availability
      : "unknown";
  const dtoBase = {
    discountPercent: pricing.discountPercent,
    rating,
    reviewCount,
    trendingScore: p.trendingScore,
    createdAt: p.createdAt,
    lastUpdated: p.lastUpdated,
    clickCount: p.clickCount,
    viewCount: p.viewCount,
  };
  const rankScore = computeRankScore(dtoBase) + (direct ? 0.35 : 0);
  return {
    id: p.id, asin: p.asin, slug: p.slug, title: p.title, description: p.description, brand: p.brand,
    categoryId: p.categoryId, categorySlug: p.category?.slug, categoryName: p.category?.name,
    subcategory: p.subcategory ?? null, images,
    quantity: p.quantity != null && p.quantity >= 1 ? p.quantity : parseQuantityFromTitle(p.title),
    price: pricing.price, originalPrice: pricing.originalPrice, discountPercent: pricing.discountPercent, priceEstimated,
    rating, reviewCount,
    affiliateUrl: generateAffiliateLink(p.retailer, { asin: p.asin, url: p.affiliateUrl }),
    retailer: p.retailer, availability,
    availabilityVerified: direct && inventoryDecision.availabilityVerified,
    inventoryVerifiedAt: direct ? inventoryDecision.observedAt?.toISOString() ?? null : null,
    inventoryExpiresAt: direct ? inventoryDecision.expiresAt?.toISOString() ?? null : null,
    priceVerified: direct || (!priceEstimated && integrity.priceVerified),
    metadataVerified: integrity.metadataVerified,
    priceSource: direct ? "dealforge" : priceEstimated ? "dealforge_estimate" : p.priceSource,
    priceVerifiedAt: direct ? p.priceVerifiedAt?.toISOString() ?? null : (!priceEstimated && integrity.priceVerified ? p.priceVerifiedAt?.toISOString() ?? null : null),
    metadataSource: direct ? null : p.metadataSource,
    metadataVerifiedAt: direct ? null : (integrity.metadataVerified ? p.metadataVerifiedAt?.toISOString() ?? null : null),
    specifications: specs, trendingScore: p.trendingScore, clickCount: p.clickCount, viewCount: p.viewCount,
    isFeatured: p.isFeatured, isFlashDeal: p.isFlashDeal, flashEndsAt: p.flashEndsAt?.toISOString() ?? null,
    lastUpdated: p.lastUpdated.toISOString(), createdAt: p.createdAt.toISOString(), rankScore,
    purchaseMode: direct ? "direct" : "affiliate",
    commerceReady: direct,
    currency: p.currency.toLowerCase(),
  };
}

export type ProductQuery = {
  q?: string; category?: string; subcategory?: string; brand?: string; minPrice?: number; maxPrice?: number;
  minRating?: number; minDiscount?: number; sort?: string; page?: number; limit?: number; featured?: boolean;
  flash?: boolean; trending?: boolean; newest?: boolean;
};

export function publicCatalogWhere(): Prisma.ProductWhereInput {
  if (isCertificationCatalogMode()) {
    return {
      AND: [
        { id: { in: [...CERTIFICATION_CATALOG_PRODUCT_IDS] } },
        { availability: { not: "out_of_stock" } },
      ],
    };
  }
  return {
    AND: [
      { availability: { not: "out_of_stock" } },
      { NOT: { id: { startsWith: "cert_" } } },
      { NOT: { specifications: { contains: '\"internalCertification\":true' } } },
      { NOT: { specifications: { contains: '\"internalCertification\": true' } } },
      { NOT: { specifications: { contains: '\"needsEnrichment\":true' } } },
      { NOT: { specifications: { contains: '\"needsEnrichment\": true' } } },
      { NOT: { title: { startsWith: "Coach product " } } },
      { NOT: { title: { startsWith: "Amazon listing " } } },
    ],
  };
}

function buildWhere(params: ProductQuery): Prisma.ProductWhereInput {
  const ci = process.env.DATABASE_URL?.startsWith("postgres") || process.env.DATABASE_URL?.startsWith("postgresql") ? ({ mode: "insensitive" as const }) : {};
  const where: Prisma.ProductWhereInput = publicCatalogWhere();
  if (params.q) where.OR = [{ title: { contains: params.q, ...ci } }, { brand: { contains: params.q, ...ci } }, { description: { contains: params.q, ...ci } }];
  if (params.category) where.category = { slug: params.category };
  if (params.subcategory) where.subcategory = params.subcategory;
  if (params.brand) where.brand = { contains: params.brand, ...ci };
  if (params.minPrice != null || params.maxPrice != null) {
    where.price = {};
    if (params.minPrice != null) where.price.gte = params.minPrice;
    if (params.maxPrice != null) where.price.lte = params.maxPrice;
  }
  if (params.minRating != null) where.rating = { gte: params.minRating };
  if (params.minDiscount != null) where.discountPercent = { gte: params.minDiscount };
  if (params.featured) where.isFeatured = true;
  if (params.flash) where.isFlashDeal = true;
  return where;
}

function buildOrderBy(params: ProductQuery): Prisma.ProductOrderByWithRelationInput[] {
  if (params.trending) return [{ trendingScore: "desc" }, { reviewCount: "desc" }];
  if (params.newest && !params.sort) return [{ createdAt: "desc" }];
  switch (params.sort) {
    case "newest": return [{ createdAt: "desc" }];
    case "rating": return [{ rating: "desc" }, { reviewCount: "desc" }];
    case "popularity": return [{ clickCount: "desc" }, { viewCount: "desc" }];
    case "savings": return [{ discountPercent: "desc" }, { rating: "desc" }];
    case "price_asc": return [{ price: "asc" }];
    case "price_desc": return [{ price: "desc" }];
    default: return [{ discountPercent: "desc" }, { rating: "desc" }, { reviewCount: "desc" }, { trendingScore: "desc" }];
  }
}

function applyInventoryAwareDefaultRanking(items: ProductDTO[], params: ProductQuery) {
  if (params.sort || params.trending || params.newest) return items;
  return [...items].sort((left, right) => {
    const readiness = Number(right.commerceReady) - Number(left.commerceReady);
    if (readiness !== 0) return readiness;
    return right.rankScore - left.rankScore;
  });
}

export async function queryProducts(params: ProductQuery) {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(48, Math.max(1, params.limit ?? 24));
  const scope = certificationCatalogScopeKey();
  const cacheKey = `products:v14:${scope}:${JSON.stringify(params)}`;
  const cached = await cacheGet<{ items: ProductDTO[]; total: number; page: number; hasMore: boolean }>(cacheKey);
  if (cached) return cached;
  const where = buildWhere(params); const orderBy = buildOrderBy(params); const skip = (page - 1) * limit;
  const countKey = `products:count:v7:${scope}:${JSON.stringify({ q: params.q, category: params.category, subcategory: params.subcategory, brand: params.brand, minPrice: params.minPrice, maxPrice: params.maxPrice, minRating: params.minRating, minDiscount: params.minDiscount, featured: params.featured, flash: params.flash })}`;
  const [cachedTotal, rows] = await Promise.all([cacheGet<number>(countKey), prisma.product.findMany({ where, select: productListSelect, orderBy, skip, take: limit })]);
  let total = cachedTotal;
  if (total == null) { total = await prisma.product.count({ where }); await cacheSet(countKey, total, 120); }
  const hydrated = await toPublicProductDTOs(rows);
  const items = applyInventoryAwareDefaultRanking(hydrated, params);
  const result = { items, total, page, hasMore: skip + limit < total };
  // Never cache a positive direct-commerce claim across its inventory TTL. A
  // later request must re-read the immutable observation and re-run the binding.
  if (!items.some((item) => item.commerceReady)) await cacheSet(cacheKey, result, 45);
  return result;
}

function internalCertificationRecord(product: Pick<ProductWithCategory, "id" | "specifications">) {
  if (product.id.startsWith("cert_")) return true;
  const root = parseJson<Record<string, unknown>>(product.specifications, {});
  return root.internalCertification === true;
}

export async function getProductBySlug(slug: string) {
  const product = await prisma.product.findFirst({
    where: { AND: [publicCatalogWhere(), { slug }] },
    select: productListSelect,
  });
  if (!product) return null;
  const [dto] = await toPublicProductDTOs([product]);
  if (!dto) return null;
  if (isCertificationCatalogMode()) {
    return isCertificationCatalogProduct(product) ? dto : null;
  }
  return !internalCertificationRecord(product) ? dto : null;
}

export async function getSimilarProducts(product: ProductDTO, limit = 8) {
  const rows = await prisma.product.findMany({
    where: { AND: [publicCatalogWhere(), { categoryId: product.categoryId, id: { not: product.id } }] },
    select: productListSelect,
    orderBy: [{ discountPercent: "desc" }, { rating: "desc" }],
    take: Math.min(24, Math.max(1, limit)),
  });
  return toPublicProductDTOs(rows);
}

export async function getRelatedProducts(product: ProductDTO, limit = 8) {
  const rows = await prisma.product.findMany({
    where: { AND: [publicCatalogWhere(), { brand: product.brand, id: { not: product.id } }] },
    select: productListSelect,
    orderBy: [{ rating: "desc" }, { reviewCount: "desc" }],
    take: Math.min(24, Math.max(1, limit)),
  });
  return toPublicProductDTOs(rows);
}

export async function getCategories() {
  const scope = certificationCatalogScopeKey();
  const cacheKey = `categories:public:v3:${scope}`;
  const cached = await cacheGet<Awaited<ReturnType<typeof fetchCategories>>>(cacheKey);
  if (cached) return cached; const data = await fetchCategories(); await cacheSet(cacheKey, data, 60); return data;
}
async function fetchCategories() {
  return prisma.category.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { products: { where: publicCatalogWhere() } } } },
  });
}
export async function getTopBrands(limit = 200) {
  const boundedLimit = Math.min(200, Math.max(1, limit));
  const scope = certificationCatalogScopeKey();
  const cacheKey = `brands:public:v3:${scope}:${boundedLimit}`; const cached = await cacheGet<string[]>(cacheKey); if (cached) return cached;
  const grouped = await prisma.product.groupBy({ where: publicCatalogWhere(), by: ["brand"], _count: { brand: true }, orderBy: { _count: { brand: "desc" } }, take: boundedLimit });
  const brands = grouped.map((g) => g.brand).filter(Boolean).sort((a, b) => a.localeCompare(b)); await cacheSet(cacheKey, brands, 300); return brands;
}
export async function recordProductView(productId: string) { await prisma.product.update({ where: { id: productId }, data: { viewCount: { increment: 1 } } }); }
export async function recordClick(productId: string, userId?: string) {
  await prisma.$transaction([prisma.clickEvent.create({ data: { productId, userId: userId ?? null, source: "web" } }), prisma.product.update({ where: { id: productId }, data: { clickCount: { increment: 1 }, trendingScore: { increment: 1.5 } } })]);
}
