import { NextResponse } from "next/server";
import { queryProducts } from "@/lib/products";

const PUBLIC_SORTS = new Set(["rank", "newest", "popularity"]);

function positiveInteger(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const requestedSort = searchParams.get("sort") || "rank";
  const sort = PUBLIC_SORTS.has(requestedSort) ? requestedSort : "rank";

  const result = await queryProducts({
    q: searchParams.get("q") || undefined,
    category: searchParams.get("category") || undefined,
    subcategory: searchParams.get("subcategory") || undefined,
    brand: searchParams.get("brand") || undefined,
    sort,
    page: positiveInteger(searchParams.get("page"), 1),
    limit: positiveInteger(searchParams.get("limit"), 24),
    featured: searchParams.get("featured") === "1",
    flash: searchParams.get("flash") === "1",
    trending: searchParams.get("trending") === "1",
  });

  return NextResponse.json(result, {
    headers: {
      "cache-control": "public, max-age=30, stale-while-revalidate=60",
    },
  });
}
