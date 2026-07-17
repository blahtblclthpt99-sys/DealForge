import { NextResponse } from "next/server";
import { queryProducts } from "@/lib/products";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const num = (k: string) => {
    const v = searchParams.get(k);
    return v ? Number(v) : undefined;
  };

  const result = await queryProducts({
    q: searchParams.get("q") || undefined,
    category: searchParams.get("category") || undefined,
    subcategory: searchParams.get("subcategory") || undefined,
    brand: searchParams.get("brand") || undefined,
    minPrice: num("minPrice"),
    maxPrice: num("maxPrice"),
    minRating: num("minRating"),
    minDiscount: num("minDiscount"),
    sort: searchParams.get("sort") || undefined,
    page: num("page") || 1,
    limit: num("limit") || 24,
    featured: searchParams.get("featured") === "1",
    flash: searchParams.get("flash") === "1",
    trending: searchParams.get("trending") === "1",
  });

  return NextResponse.json(result);
}
