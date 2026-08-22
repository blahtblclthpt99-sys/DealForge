/**
 * Product query layer — DB-level pagination (never loads the full catalog).
 * Public DTOs distinguish verified-current prices from older recorded catalog prices.
 */
import { prisma } from "./db";
import { cacheGet, cacheSet } from "./cache";
import { generateAffiliateLink } from "./affiliate/registry";
import { computeRankScore } from "./ranking";
import { parseJson } from "./utils";
import { normalizeProductImage } from "./product-image";
import { parseQuantityFromTitle } from "./quantity";
import {
  publicProductVisibilityClauses,
  publicProductWhere,
} from "./product-visibility";
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
  recordedPrice: number;
  recordedPriceAvailable: boolean;
  rating: number;
  reviewCount: number;
  affiliateUrl: string;
  retailer: string;
  availability: string;
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
};

type ProductWithCategory = Prisma.ProductGetPayload<{ include: { category: true } }>;

const MAX_QUERY_LENGTH = 120;
const MAX_FILTER_LENGTH = 100;
const MAX_PAGE = 500;
const MAX_LIMIT = 48;
const AMAZON_PRICE_TTL_MS = 24 * 60 * 60 * 1000;
const ALLOWED_SORTS = new Set(["rank", "newest", "popularity"]);
const TRUSTED_AMAZON_PRICE_SOURCES = new Set([
  "amazon-creators-api",
  "amazon-pa-api",
  "amazon-data-feed",
]);

function boundedText(value: string | undefined, max: number) {
  if (!value) return undefined;
  const text = value.trim().slice(0, max);
  return text || undefined;
}

function boundedNumber(value: number | undefined, min: number, max: number) {
  if (value == null || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

export function normalizeProductQuery(params: ProductQuery): ProductQuery {
  const rawPage = boundedNumber(params.page, 1, MAX_PAGE) ?? 1;
  const rawLimit = boundedNumber(params.limit, 1, MAX_LIMIT) ?? 24;
  const sort = params.sort && ALLOWED_SORTS.has(params.sort) ? params.sort : undefined;

  // Until retailer-authorized price/rating data is consistently refreshed,
  // public catalog queries must not filter or sort on legacy Amazon commerce
  // fields. Keeping these inputs ignored also protects older saved URLs.
  return {
    q: boundedText(params.q, MAX_QUERY_LENGTH),
    category: boundedText(params.category, MAX_FILTER_LENGTH),
    subcategory: boundedText(params.subcategory, MAX_FILTER_LENGTH),
    brand: boundedText(params.brand, MAX_FILTER_LENGTH),
    minPrice: undefined,
    maxPrice: undefined,
    minRating: undefined,
    minDiscount: undefined,
    sort,
    page: Math.floor(rawPage),
    limit: Math.floor(rawLimit),
    featured: Boolean(params.featured),
    flash: Boolean(params.flash),
    trending: Boolean(params.trending),
    newest: Boolean(params.newest),
  };
}

function cleanImages(raw: string): string[] {
  const list = parseJson<string[]>(raw, []).filter(Boolean);
  const normalized = list
    .map((u) => normalizeProductImage(u))
    .filter((u) => u && !u.includes("placeholder"));
  return normalized.length
    ? Array.from(new Set(normalized))
    : ["/images/placeholder-product.svg"];
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
  } else {
    d = 0;
  }
  return { price: p, originalPrice: o, discountPercent: d };
}

function timestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasFreshTrustedAmazonCommerce(
  retailer: string,
  specs: Record<string, string>,
  lastUpdated: Date,
) {
  if (retailer.trim().toLowerCase() !== "amazon") return true;
  const source = typeof specs.priceSource === "string" ? specs.priceSource.trim().toLowerCase() : "";
  if (!TRUSTED_AMAZON_PRICE_SOURCES.has(source)) return false;
  const checked = timestamp(specs.priceCheckedAt) ?? lastUpdated.getTime();
  return checked != null && Date.now() - checked <= AMAZON_PRICE_TTL_MS;
}

export function toProductDTO(
  p: ProductWithCategory | Prisma.ProductGetPayload<object>,
): ProductDTO {
  const withCat = p as ProductWithCategory;
  const images = cleanImages(p.images);
  const specs = parseJson<Record<string, string>>(p.specifications, {});
  const storedPricing = sanitizePricing(p.price, p.originalPrice, p.discountPercent);
  const freshCommerce = hasFreshTrustedAmazonCommerce(p.retailer, specs, p.lastUpdated);
  const isAmazon = p.retailer.trim().toLowerCase() === "amazon";
  const recordedPriceAvailable = isAmazon && storedPricing.price > 0 && !freshCommerce;
  const publicPricing = freshCommerce
    ? storedPricing
    : { price: 0, originalPrice: 0, discountPercent: 0 };
  const publicRating = freshCommerce ? p.rating : 0;
  const publicReviewCount = freshCommerce ? p.reviewCount : 0;
  const dtoBase = {
    discountPercent: publicPricing.discountPercent,
    rating: publicRating,
    reviewCount: publicReviewCount,
    trendingScore: p.trendingScore,
    createdAt: p.createdAt,
    lastUpdated: p.lastUpdated,
    clickCount: p.clickCount,
    viewCount: p.viewCount,
  };
  return {
    id: p.id,
    asin: p.asin,
    slug: p.slug,
    title: p.title,
    description: p.description,
    brand: p.brand,
    categoryId: p.categoryId,
    categorySlug: withCat.category?.slug,
    categoryName: withCat.category?.name,
    subcategory: p.subcategory ?? null,
    images,
    quantity:
      p.quantity != null && p.quantity >= 1
        ? p.quantity
        : parseQuantityFromTitle(p.title),
    price: publicPricing.price,
    originalPrice: publicPricing.originalPrice,
    discountPercent: publicPricing.discountPercent,
    recordedPrice: storedPricing.price,
    recordedPriceAvailable,
    rating: publicRating,
    reviewCount: publicReviewCount,
    affiliateUrl: generateAffiliateLink(p.retailer, {
      asin: p.asin,
      url: p.affiliateUrl,
    }),
    retailer: p.retailer,
    availability: p.availability,
    specifications: specs,
    trendingScore: p.trendingScore,
    clickCount: p.clickCount,
    viewCount: p.viewCount,
    isFeatured: p.isFeatured,
    isFlashDeal: freshCommerce ? p.isFlashDeal : false,
    flashEndsAt: freshCommerce ? p.flashEndsAt?.toISOString() ?? null : null,
    lastUpdated: p.lastUpdated.toISOString(),
    createdAt: p.createdAt.toISOString(),
    rankScore: computeRankScore(dtoBase),
  };
}

export type ProductQuery = {
  q?: string;
  category?: string;
  subcategory?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  minDiscount?: number;
  sort?: string;
  page?: number;
  limit?: number;
  featured?: boolean;
  flash?: boolean;
  trending?: boolean;
  newest?: boolean;
};

function buildWhere(params: ProductQuery): Prisma.ProductWhereInput {
  const ci =
    process.env.DATABASE_URL?.startsWith("postgres") ||
    process.env.DATABASE_URL?.startsWith("postgresql")
      ? ({ mode: "insensitive" as const })
      : {};

  const where: Prisma.ProductWhereInput = {
    AND: [...publicProductVisibilityClauses()],
  };

  if (params.q) {
    where.OR = [
      { title: { contains: params.q, ...ci } },
      { brand: { contains: params.q, ...ci } },
      { description: { contains: params.q, ...ci } },
    ];
  }
  if (params.category) where.category = { slug: params.category };
  if (params.subcategory) where.subcategory = params.subcategory;
  if (params.brand) where.brand = { contains: params.brand, ...ci };
  if (params.featured) where.isFeatured = true;
  if (params.flash) where.isFlashDeal = true;
  return where;
}

function buildOrderBy(params: ProductQuery): Prisma.ProductOrderByWithRelationInput[] {
  if (params.trending) {
    return [{ clickCount: "desc" }, { viewCount: "desc" }, { createdAt: "desc" }];
  }
  if (params.newest && !params.sort) {
    return [{ createdAt: "desc" }];
  }
  switch (params.sort) {
    case "newest":
      return [{ createdAt: "desc" }];
    case "popularity":
      return [{ clickCount: "desc" }, { viewCount: "desc" }, { createdAt: "desc" }];
    case "rank":
    default:
      return [{ clickCount: "desc" }, { viewCount: "desc" }, { createdAt: "desc" }];
  }
}

export async function queryProducts(params: ProductQuery) {
  const normalized = normalizeProductQuery(params);
  const page = normalized.page ?? 1;
  const limit = normalized.limit ?? 24;
  const cacheKey = `products:v11:${JSON.stringify(normalized)}`;
  const cached = await cacheGet<{
    items: ProductDTO[];
    total: number;
    page: number;
    hasMore: boolean;
  }>(cacheKey);
  if (cached) return cached;

  const where = buildWhere(normalized);
  const orderBy = buildOrderBy(normalized);
  const skip = (page - 1) * limit;

  const countKey = `products:count:v8:${JSON.stringify({
    q: normalized.q,
    category: normalized.category,
    subcategory: normalized.subcategory,
    brand: normalized.brand,
    featured: normalized.featured,
    flash: normalized.flash,
  })}`;

  const [cachedTotal, rows] = await Promise.all([
    cacheGet<number>(countKey),
    prisma.product.findMany({
      where,
      include: { category: true },
      orderBy,
      skip,
      take: limit,
    }),
  ]);

  let total = cachedTotal;
  if (total == null) {
    total = await prisma.product.count({ where });
    await cacheSet(countKey, total, 120);
  }

  const result = {
    items: rows.map(toProductDTO),
    total,
    page,
    hasMore: skip + limit < total,
  };

  await cacheSet(cacheKey, result, 45);
  return result;
}

export async function getProductBySlug(slug: string) {
  const product = await prisma.product.findFirst({
    where: publicProductWhere({ slug }),
    include: { category: true },
  });
  if (!product) return null;
  return toProductDTO(product);
}

export async function getCategories() {
  const key = "categories:all:v3";
  const cached = await cacheGet<
    { id: string; name: string; slug: string; icon: string; count: number }[]
  >(key);
  if (cached) return cached;

  const [cats, grouped] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.product.groupBy({
      by: ["categoryId"],
      where: publicProductWhere(),
      _count: { categoryId: true },
    }),
  ]);
  const counts = new Map(grouped.map((row) => [row.categoryId, row._count.categoryId]));
  const result = cats.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    icon: c.icon,
    count: counts.get(c.id) ?? 0,
  }));
  await cacheSet(key, result, 300);
  return result;
}

export async function getTopBrands(limit = 100) {
  const safeLimit = Math.min(200, Math.max(1, Math.trunc(limit)));
  const brands = await prisma.product.groupBy({
    by: ["brand"],
    where: publicProductWhere(),
    _count: { brand: true },
    orderBy: { _count: { brand: "desc" } },
    take: safeLimit,
  });
  return brands.map((b) => b.brand).filter(Boolean);
}

export async function getSimilarProducts(product: ProductDTO, limit = 4) {
  const safeLimit = Math.min(12, Math.max(1, Math.trunc(limit)));
  const rows = await prisma.product.findMany({
    where: publicProductWhere({
      id: { not: product.id },
      categoryId: product.categoryId,
    }),
    include: { category: true },
    orderBy: [{ clickCount: "desc" }, { viewCount: "desc" }, { createdAt: "desc" }],
    take: safeLimit,
  });
  return rows.map(toProductDTO);
}

export async function getRelatedProducts(product: ProductDTO, limit = 4) {
  const safeLimit = Math.min(12, Math.max(1, Math.trunc(limit)));
  const rows = await prisma.product.findMany({
    where: publicProductWhere({
      id: { not: product.id },
      brand: product.brand,
    }),
    include: { category: true },
    orderBy: [{ clickCount: "desc" }, { viewCount: "desc" }, { createdAt: "desc" }],
    take: safeLimit,
  });
  return rows.map(toProductDTO);
}

export async function recordProductView(productId: string) {
  try {
    await prisma.product.update({
      where: { id: productId },
      data: { viewCount: { increment: 1 } },
    });
  } catch {
    // Analytics must never break product rendering.
  }
}

export async function recordClick(productId: string, userId?: string) {
  await prisma.$transaction([
    prisma.clickEvent.create({
      data: { productId, userId: userId ?? null, source: "web" },
    }),
    prisma.product.update({
      where: { id: productId },
      data: {
        clickCount: { increment: 1 },
        trendingScore: { increment: 1.5 },
      },
    }),
  ]);
}
