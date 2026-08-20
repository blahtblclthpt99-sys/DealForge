import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchClient } from "@/components/search-client";
import { getCategories, getTopBrands, queryProducts } from "@/lib/products";

export const metadata: Metadata = {
  title: "Search",
  description: "Search DealForge products by keyword, category, brand, recency, and popularity.",
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
  const requestedSort = get("sort") || "rank";
  const safeSort = ["rank", "newest", "popularity"].includes(requestedSort)
    ? requestedSort
    : "rank";

  const [result, categories, brands] = await Promise.all([
    queryProducts({
      q: get("q"),
      category: get("category"),
      brand: get("brand"),
      sort: safeSort,
      featured: get("featured") === "1",
      page: 1,
      limit: 48,
    }),
    getCategories(),
    getTopBrands(200),
  ]);

  return (
    <div className="dn-container py-10 md:py-14">
      <div className="max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-forest">Product finder</p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-forest-ink md:text-5xl">
          Search DealForge
        </h1>
        <p className="mt-3 leading-7 text-forest-muted">
          Search by product, category, and brand. Exact Amazon price and savings filters stay disabled until the catalog is refreshed through an approved Amazon pricing source.
        </p>
      </div>
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
