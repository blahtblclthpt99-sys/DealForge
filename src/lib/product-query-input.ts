import { z } from "zod";
import type { ProductQuery } from "./products";

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((value) => value || undefined);

const optionalNumber = (min: number, max: number) =>
  z.string()
    .trim()
    .regex(/^-?(?:\d+\.?\d*|\.\d+)$/)
    .transform(Number)
    .refine(Number.isFinite)
    .refine((value) => value >= min && value <= max)
    .optional();

const optionalInteger = (min: number, max: number) =>
  z.string()
    .trim()
    .regex(/^\d+$/)
    .transform(Number)
    .refine(Number.isSafeInteger)
    .refine((value) => value >= min && value <= max)
    .optional();

const flag = z.enum(["0", "1"]).optional().transform((value) => value === "1");

const PublicProductQuerySchema = z
  .object({
    q: optionalText(200),
    category: optionalText(100),
    subcategory: optionalText(100),
    brand: optionalText(160),
    minPrice: optionalNumber(0, 1_000_000),
    maxPrice: optionalNumber(0, 1_000_000),
    minRating: optionalNumber(0, 5),
    minDiscount: optionalNumber(0, 100),
    sort: z
      .enum(["rank", "newest", "rating", "popularity", "savings", "price_asc", "price_desc"])
      .optional(),
    page: optionalInteger(1, 10_000),
    limit: optionalInteger(1, 48),
    featured: flag,
    flash: flag,
    trending: flag,
  })
  .superRefine((value, context) => {
    if (value.minPrice !== undefined && value.maxPrice !== undefined && value.minPrice > value.maxPrice) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minPrice"],
        message: "minPrice must not exceed maxPrice",
      });
    }
  });

export function parsePublicProductQuery(searchParams: URLSearchParams) {
  const raw = Object.fromEntries(
    [
      "q",
      "category",
      "subcategory",
      "brand",
      "minPrice",
      "maxPrice",
      "minRating",
      "minDiscount",
      "sort",
      "page",
      "limit",
      "featured",
      "flash",
      "trending",
    ].flatMap((key) => {
      const value = searchParams.get(key);
      return value === null ? [] : [[key, value] as const];
    }),
  );

  const parsed = PublicProductQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false as const, issues: parsed.error.flatten() };
  }

  const value = parsed.data;
  const query: ProductQuery = {
    q: value.q,
    category: value.category,
    subcategory: value.subcategory,
    brand: value.brand,
    minPrice: value.minPrice,
    maxPrice: value.maxPrice,
    minRating: value.minRating,
    minDiscount: value.minDiscount,
    sort: value.sort,
    page: value.page ?? 1,
    limit: value.limit ?? 24,
    featured: value.featured,
    flash: value.flash,
    trending: value.trending,
  };
  return { ok: true as const, query };
}
