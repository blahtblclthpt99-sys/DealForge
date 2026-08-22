import type { Metadata } from "next";
import { Search, ShieldCheck, Sparkles } from "lucide-react";
import { Suspense } from "react";
import { SearchClient } from "@/components/search-client";
import { getCategories, getTopBrands, queryProducts } from "@/lib/products";

export const metadata: Metadata = {
  title: "Product Finder",
  description: "Search DealForge products by product intent, category, brand, recency, and popularity.",
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function bounded(value: string | undefined, max: number) {
  return value?.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || undefined;
}

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const requestedSort = bounded(first(sp.sort), 24) || "rank";
  const safeSort = ["rank", "newest", "popularity"].includes(requestedSort) ? requestedSort : "rank";

  const [result, categories, brands] = await Promise.all([
    queryProducts({
      q: bounded(first(sp.q), 120),
      category: bounded(first(sp.category), 100),
      brand: bounded(first(sp.brand), 100),
      sort: safeSort,
      featured: first(sp.featured) === "1",
      page: 1,
      limit: 48,
    }),
    getCategories(),
    getTopBrands(200),
  ]);

  return (
    <div>
      <section className="border-b border-card-border bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,.12),transparent_38%)]">
        <div className="dn-container py-10 md:py-14">
          <div className="max-w-4xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#F97316]/20 bg-[#F97316]/8 px-3 py-1.5 text-xs font-extrabold uppercase tracking-[0.14em] text-[#F97316]">
              <Sparkles className="h-3.5 w-3.5" /> Product Finder
            </div>
            <h1 className="mt-4 font-display text-4xl font-semibold tracking-[-0.035em] text-forest-ink md:text-6xl">
              Tell DealForge what you need. <span className="text-[#F97316]">We’ll narrow the catalog.</span>
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-forest-muted md:text-lg">
              Search by product, use case, brand, or category. DealForge keeps unverified Amazon commerce claims out of the result cards and sends you to the retailer to confirm the current offer.
            </p>
            <div className="mt-5 flex flex-wrap gap-3 text-xs font-semibold text-forest-muted">
              <span className="inline-flex items-center gap-1.5"><Search className="h-4 w-4 text-[#F97316]" /> Intent-first search</span>
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-[#F97316]" /> Price-integrity guard</span>
            </div>
          </div>
        </div>
      </section>

      <div className="dn-container py-8 md:py-10">
        <Suspense fallback={<div className="skeleton h-[34rem] rounded-2xl" />}>
          <SearchClient
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
