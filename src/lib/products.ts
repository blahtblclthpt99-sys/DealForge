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
import { evaluateCommerceGate } from "./commerce-gate";
import { recommendCommercialPrice } from "./commercialization";
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

const AMAZON_PRICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const AMAZON_METADATA_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const AUTHORIZED_AMAZON_PRICE_SOURCES = new Set(["amazon_creators_api", "amazon_authorized_api", "amazon_owner_verified"]);
const AUTHORIZED_AMAZON_METADATA_SOURCES = new Set(["amazon_creators_api", "amazon_authorized_api", "amazon_owner_verified"]);
const PRIVATE_SPECIFICATION_KEYS = new Set([
  "supplierOfferV1",
  "commerceV1",
  "internalCertification",
  "productEngine",
  "sourceType",
  "needsEnrichment",
]);

function isFresh(date: Date | null, maxAgeMs: number) {
  return Boolean(date && Date.now() - date.getTime() >= 0 && Date.now() - date.getTime() <= maxAgeMs);
}

export function amazonClaimIntegrity(input: {
  retailer: string;
  priceSource: string | null;
  priceVerifiedAt: Date | null;
  metadataSource: string | null;
  metadataVerifiedAt: Date | null;
}) {
  if (input.retailer !== "amazon") return { priceVerified: true, metadataVerified: true };
  return {
    priceVerified: Boolean(input.priceSource && AUTHORIZED_AMAZON_PRICE_SOURCES.has(input.priceSource) && isFresh(input.priceVerifiedAt, AMAZON_PRICE_MAX_AGE_MS)),
    metadataVerified: Boolean(input.metadataSource && AUTHORIZED_AMAZON_METADATA_SOURCES.has(input.metadataSource) && isFresh(input.metadataVerifiedAt, AMAZON_METADATA_MAX_AGE_MS)),
  };
}

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
  if (process.env.COMMERCE_ENABLED !== "true") return { allowed: false } as const;
  return evaluateCommerceGate({
    commerceEnabled: p.commerceEnabled,
    availability: p.availability,
    sellingPriceCents: p.sellingPriceCents,
    landedCostCents: p.landedCostCents,
    priceVerifiedAt: p.priceVerifiedAt,
    specifications: p.specifications,
  });
}

/**
 * Storefront-only DealForge estimate. A historical catalog price is treated
 * conservatively as the estimated acquisition basis and passed through the
 * same reserve/profit/margin pricing model used by DealForge commercialization.
 * This value is never accepted by checkout; checkout uses only the persisted,
 * server-verified sellingPriceCents after the commerce gate passes.
 */
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

export function toProductDTO(p: ProductWithCategory): ProductDTO {
  const images = cleanImages(p.images);
  const specs = publicSpecifications(p.specifications);
  const integrity = amazonClaimIntegrity({
    retailer: p.retailer,
    priceSource: p.priceSource,
    priceVerifiedAt: p.priceVerifiedAt,
    metadataSource: p.metadataSource,
    metadataVerifiedAt: p.metadataVerifiedAt,
  });
  const commerce = directCommerceDecision(p);
  const direct = commerce.allowed && Number.isSafeInteger(p.sellingPriceCents) && (p.sellingPriceCents ?? 0) > 0;
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
  const availability = direct ? p.availability : integrity.metadataVerified ? p.availability : "unknown";
  const dtoBase = { discountPercent: pricing.discountPercent, rating, reviewCount, trendingScore: p.trendingScore, createdAt: p.createdAt, lastUpdated: p.lastUpdated, clickCount: p.clickCount, viewCount: p.viewCount };
  return {
    id: p.id, asin: p.asin, slug: p.slug, title: p.title, description: p.description, brand: p.brand,
    categoryId: p.categoryId, categorySlug: p.category?.slug, categoryName: p.category?.name,
    subcategory: p.subcategory ?? null, images,
    quantity: p.quantity != null && p.quantity >= 1 ? p.quantity : parseQuantityFromTitle(p.title),
    price: pricing.price, originalPrice: pricing.originalPrice, discountPercent: pricing.discountPercent, priceEstimated,
    rating, reviewCount,
    affiliateUrl: generateAffiliateLink(p.retailer, { asin: p.asin, url: p.affiliateUrl }),
    retailer: p.retailer, availability,
    availabilityVerified: direct || integrity.metadataVerified,
    priceVerified: direct || integrity.priceVerified,
    metadataVerified: integrity.metadataVerified,
    priceSource: direct ? "dealforge" : priceEstimated ? "dealforge_estimate" : p.priceSource,
    priceVerifiedAt: direct ? p.priceVerifiedAt?.toISOString() ?? null : null,
    metadataSource: direct ? null : p.metadataSource,
    metadataVerifiedAt: direct ? null : p.metadataVerifiedAt?.toISOString() ?? null,
    specifications: specs, trendingScore: p.trendingScore, clickCount: p.clickCount, viewCount: p.viewCount,
    isFeatured: p.isFeatured, isFlashDeal: p.isFlashDeal, flashEndsAt: p.flashEndsAt?.toISOString() ?? null,
    lastUpdated: p.lastUpdated.toISOString(), createdAt: p.createdAt.toISOString(), rankScore: computeRankScore(dtoBase),
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

function buildWhere(params: ProductQuery): Prisma.ProductWhereInput {
  const ci = process.env.DATABASE_URL?.startsWith("postgres") || process.env.DATABASE_URL?.startsWith("postgresql") ? ({ mode: "insensitive" as const }) : {};
  const where: Prisma.ProductWhereInput = {
    AND: [
      { NOT: { specifications: { contains: '\"needsEnrichment\":true' } } },
      { NOT: { specifications: { contains: '\"needsEnrichment\": true' } } },
      { NOT: { title: { startsWith: "Coach product " } } },
      { NOT: { title: { startsWith: "Amazon listing " } } },
    ],
  };
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

export async function queryProducts(params: ProductQuery) {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(48, Math.max(1, params.limit ?? 24));
  const cacheKey = `products:v11:${JSON.stringify(params)}`;
  const cached = await cacheGet<{ items: ProductDTO[]; total: number; page: number; hasMore: boolean }>(cacheKey);
  if (cached) return cached;
  const where = buildWhere(params); const orderBy = buildOrderBy(params); const skip = (page - 1) * limit;
  const countKey = `products:count:v5:${JSON.stringify({ q: params.q, category: params.category, subcategory: params.subcategory, brand: params.brand, minPrice: params.minPrice, maxPrice: params.maxPrice, minRating: params.minRating, minDiscount: params.minDiscount, featured: params.featured, flash: params.flash })}`;
  const [cachedTotal, rows] = await Promise.all([cacheGet<number>(countKey), prisma.product.findMany({ where, select: productListSelect, orderBy, skip, take: limit })]);
  let total = cachedTotal;
  if (total == null) { total = await prisma.product.count({ where }); await cacheSet(countKey, total, 120); }
  const result = { items: rows.map(toProductDTO), total, page, hasMore: skip + limit < total };
  await cacheSet(cacheKey, result, 45); return result;
}

export async function getProductBySlug(slug: string) {
  const product = await prisma.product.findUnique({ where: { slug }, select: productListSelect });
  return product ? toProductDTO(product) : null;
}

export async function getSimilarProducts(product: ProductDTO, limit = 8) {
  const rows = await prisma.product.findMany({ where: { categoryId: product.categoryId, id: { not: product.id } }, select: productListSelect, orderBy: [{ discountPercent: "desc" }, { rating: "desc" }], take: limit });
  return rows.map(toProductDTO);
}

export async function getRelatedProducts(product: ProductDTO, limit = 8) {
  const rows = await prisma.product.findMany({ where: { brand: product.brand, id: { not: product.id } }, select: productListSelect, orderBy: [{ rating: "desc" }, { reviewCount: "desc" }], take: limit });
  return rows.map(toProductDTO);
}

export async function getCategories() {
  const cached = await cacheGet<Awaited<ReturnType<typeof fetchCategories>>>("categories:all");
  if (cached) return cached; const data = await fetchCategories(); await cacheSet("categories:all", data, 60); return data;
}
async function fetchCategories() { return prisma.category.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { products: true } } } }); }
export async function getTopBrands(limit = 200) {
  const cacheKey = `brands:top:${limit}`; const cached = await cacheGet<string[]>(cacheKey); if (cached) return cached;
  const grouped = await prisma.product.groupBy({ by: ["brand"], _count: { brand: true }, orderBy: { _count: { brand: "desc" } }, take: limit });
  const brands = grouped.map((g) => g.brand).filter(Boolean).sort((a, b) => a.localeCompare(b)); await cacheSet(cacheKey, brands, 300); return brands;
}
export async function recordProductView(productId: string) { await prisma.product.update({ where: { id: productId }, data: { viewCount: { increment: 1 } } }); }
export async function recordClick(productId: string, userId?: string) {
  await prisma.$transaction([prisma.clickEvent.create({ data: { productId, userId: userId ?? null, source: "web" } }), prisma.product.update({ where: { id: productId }, data: { clickCount: { increment: 1 }, trendingScore: { increment: 1.5 } } })]);
}