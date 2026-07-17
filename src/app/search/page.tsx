import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchClient } from "@/components/search-client";
import { getCategories, getTopBrands, queryProducts } from "@/lib/products";

export const metadata: Metadata = {
  title: "Search",
  description: "Live search DealForge products with filters for price, rating, brand, and savings.",
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const get = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const [result, categories, brands] = await Promise.all([
    queryProducts({
      q: get("q"),
      category: get("category"),
      brand: get("brand"),
      minPrice: get("minPrice") ? Number(get("minPrice")) : undefined,
      maxPrice: get("maxPrice") ? Number(get("maxPrice")) : undefined,
      minRating: get("minRating") ? Number(get("minRating")) : undefined,
      minDiscount: get("minDiscount") ? Number(get("minDiscount")) : undefined,
      sort: get("sort") || "rank",
      featured: get("featured") === "1",
      page: 1,
      limit: 48,
    }),
    getCategories(),
    getTopBrands(200),
  ]);

  return (
    <div className="dn-container py-12">
      <h1 className="font-display text-4xl font-semibold text-forest-ink">Search</h1>
      <p className="mt-2 text-forest-muted">Filter by category, price, rating, brand, and discount.</p>
      <div className="mt-8">
        <Suspense fallback={<div className="skeleton h-96 rounded-2xl" />}>
          <SearchClient
            initialItems={result.items}
            initialTotal={result.total}
            categories={categories.map((c) => ({ slug: c.slug, name: c.name }))}
            brands={brands}
          />
        </Suspense>
      </div>
    </div>
  );
}
