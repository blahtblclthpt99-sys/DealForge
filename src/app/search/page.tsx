import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchClientV2 } from "@/components/search-client-v2";
import { getCategories, getTopBrands, queryProducts } from "@/lib/products";

export const metadata: Metadata = {
  title: "Shop & Search",
  description: "Search DealForge products by category and brand with clear price and availability confidence.",
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const get = (key: string) => {
    const value = sp[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const [result, categories, brands] = await Promise.all([
    queryProducts({
      q: get("q"),
      category: get("category"),
      brand: get("brand"),
      sort: get("sort") || "rank",
      featured: get("featured") === "1",
      page: 1,
      limit: 48,
    }),
    getCategories(),
    getTopBrands(200),
  ]);

  return (
    <div className="dn-container py-8 md:py-12">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-forest">Shop DealForge</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-forest-ink md:text-4xl">Find what you need faster</h1>
        <p className="mt-2 text-sm text-forest-muted md:text-base">
          Search by product, brand, or category. Price and stock claims are shown only when DealForge has enough current verification to support them.
        </p>
      </div>
      <div className="mt-6 md:mt-8">
        <Suspense fallback={<div className="skeleton h-96 rounded-2xl" />}>
          <SearchClientV2
            initialItems={result.items}
            initialTotal={result.total}
            categories={categories.map((category) => ({ slug: category.slug, name: category.name }))}
            brands={brands}
          />
        </Suspense>
      </div>
    </div>
  );
}
