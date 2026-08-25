import { NextResponse } from "next/server";
import { parsePublicProductQuery } from "@/lib/product-query-input";
import { queryProducts } from "@/lib/products";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const parsed = parsePublicProductQuery(searchParams);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "INVALID_PRODUCT_QUERY", details: parsed.issues },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const result = await queryProducts(parsed.query);
  return NextResponse.json(result, {
    headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" },
  });
}
