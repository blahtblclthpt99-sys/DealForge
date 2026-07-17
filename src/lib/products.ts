/**
 * Product query layer — DB-level pagination (never loads the full catalog).
 */
import { prisma } from "./db";
import { cacheGet, cacheSet } from "./cache";
import { generateAffiliateLink } from "./affiliate/registry";
import { computeRankScore } from "./ranking";
import { parseJson } from "./utils";
import { normalizeProductImage } from "./product-image";
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
  price: number;
  originalPrice: number;
  discountPercent: number;
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

function cleanImages(raw: string): string[] {
  const list = parseJson<string[]>(raw, []).filter(Boolean);
  const normalized = list.map((u) => normalizeProductImage(u)).filter((u) => u && !u.includes("placeholder"));
  return normalized.length ? Array.from(new Set(normalized)) : ["/images/placeholder-product.svg"];
}

/** Guard against scrape garbage like $6 sale / $2014 list = 100% off. */
function sanitizePricing(price: number, originalPrice: number, discountPercent: number) {
  let p = Number.isFinite(price) && price > 0 ? price : 0;
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

export function toProductDTO(p: ProductWithCategory | Prisma.ProductGetPayload<object>): ProductDTO {
  const withCat = p as ProductWithCategory;
  const images = cleanImages(p.images);
  const specs = parseJson<Record<string, string>>(p.specifications, {});
  const pricing = sanitizePricing(p.price, p.originalPrice, p.discountPercent);
  const dtoBase = {
    discountPercent: pricing.discountPercent,
    rating: p.rating,
    reviewCount: p.reviewCount,
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
    price: pricing.price,
    originalPrice: pricing.originalPrice,
    discountPercent: pricing.discountPercent,
    rating: p.rating,
    reviewCount: p.reviewCount,
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
    isFlashDeal: p.isFlashDeal,
    flashEndsAt: p.flashEndsAt?.toISOString() ?? null,
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
  const where: Prisma.ProductWhereInput = {};

  if (params.q) {
    where.OR = [
      { title: { contains: params.q } },
      { brand: { contains: params.q } },
      { description: { contains: params.q } },
    ];
  }
  if (params.category) where.category = { slug: params.category };
  if (params.subcategory) where.subcategory = params.subcategory;
  if (params.brand) where.brand = { contains: params.brand };
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
  if (params.trending) {
    return [{ trendingScore: "desc" }, { reviewCount: "desc" }];
  }
  if (params.newest && !params.sort) {
    return [{ createdAt: "desc" }];
  }
  switch (params.sort) {
    case "newest":
      return [{ createdAt: "desc" }];
    case "rating":
      return [{ rating: "desc" }, { reviewCount: "desc" }];
    case "popularity":
      return [{ clickCount: "desc" }, { viewCount: "desc" }];
    case "savings":
      return [{ discountPercent: "desc" }, { rating: "desc" }];
    case "price_asc":
      return [{ price: "asc" }];
    case "price_desc":
      return [{ price: "desc" }];
    case "rank":
    default:
      // Approximate rank score with indexed columns — avoids loading the full catalog
      return [
        { discountPercent: "desc" },
        { rating: "desc" },
        { reviewCount: "desc" },
        { trendingScore: "desc" },
      ];
  }
}

export async function queryProducts(params: ProductQuery) {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(48, Math.max(1, params.limit ?? 24));
  const cacheKey = `products:v3:${JSON.stringify(params)}`;
  const cached = await cacheGet<{
    items: ProductDTO[];
    total: number;
    page: number;
    hasMore: boolean;
  }>(cacheKey);
  if (cached) return cached;

  const where = buildWhere(params);
  const orderBy = buildOrderBy(params);
  const skip = (page - 1) * limit;

  const countKey = `products:count:v3:${JSON.stringify({
    q: params.q,
    category: params.category,
    subcategory: params.subcategory,
    brand: params.brand,
    minPrice: params.minPrice,
    maxPrice: params.maxPrice,
    minRating: params.minRating,
    minDiscount: params.minDiscount,
    featured: params.featured,
    flash: params.flash,
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
  const product = await prisma.product.findUnique({
    where: { slug },
    include: { category: true },
  });
  if (!product) return null;
  return toProductDTO(product);
}

export async function getSimilarProducts(product: ProductDTO, limit = 8) {
  const rows = await prisma.product.findMany({
    where: {
      categoryId: product.categoryId,
      id: { not: product.id },
    },
    include: { category: true },
    orderBy: [{ discountPercent: "desc" }, { rating: "desc" }],
    take: limit,
  });
  return rows.map(toProductDTO);
}

export async function getRelatedProducts(product: ProductDTO, limit = 8) {
  const rows = await prisma.product.findMany({
    where: {
      brand: product.brand,
      id: { not: product.id },
    },
    include: { category: true },
    orderBy: [{ rating: "desc" }, { reviewCount: "desc" }],
    take: limit,
  });
  return rows.map(toProductDTO);
}

export async function getCategories() {
  const cached = await cacheGet<Awaited<ReturnType<typeof fetchCategories>>>("categories:all");
  if (cached) return cached;
  const data = await fetchCategories();
  await cacheSet("categories:all", data, 60);
  return data;
}

async function fetchCategories() {
  return prisma.category.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true } } },
  });
}

/** Top brands by product count — keeps the search filter fast. */
export async function getTopBrands(limit = 200) {
  const cacheKey = `brands:top:${limit}`;
  const cached = await cacheGet<string[]>(cacheKey);
  if (cached) return cached;

  const grouped = await prisma.product.groupBy({
    by: ["brand"],
    _count: { brand: true },
    orderBy: { _count: { brand: "desc" } },
    take: limit,
  });
  const brands = grouped.map((g) => g.brand).filter(Boolean).sort((a, b) => a.localeCompare(b));
  await cacheSet(cacheKey, brands, 300);
  return brands;
}

export async function recordProductView(productId: string) {
  await prisma.product.update({
    where: { id: productId },
    data: { viewCount: { increment: 1 } },
  });
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
