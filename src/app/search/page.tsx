import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SearchClient } from "@/components/search-client";
import { parsePublicProductQuery } from "@/lib/product-query-input";
import { getCategories, getTopBrands, queryProducts } from "@/lib/products";

export const metadata: Metadata = {
  title: "Search",
  description: "Search DealForge products with bounded, validated filters.",
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function toUrlSearchParams(input: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) params.set(key, first);
  }
  return params;
}

export default async function SearchPage({ searchParams }: Props) {
  const raw = await searchParams;
  const parsed = parsePublicProductQuery(toUrlSearchParams(raw));

  if (!parsed.ok) {
    return (
      <div className="dn-container py-12">
        <div className="mx-auto max-w-xl rounded-2xl border border-card-border bg-card p-8 text-center">
          <h1 className="font-display text-3xl font-semibold text-forest-ink">Search filters need attention</h1>
          <p className="mt-3 text-sm text-forest-muted">
            One or more search values were outside the supported range or format. Clear the filters and try again.
          </p>
          <Link
            href="/search"
            className="mt-6 inline-flex rounded-xl bg-forest px-5 py-3 text-sm font-semibold text-white transition hover:bg-forest-dark"
          >
            Clear filters
          </Link>
        </div>
      </div>
    );
  }

  const [result, categories, brands] = await Promise.all([
    queryProducts({ ...parsed.query, page: 1, limit: 48 }),
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
