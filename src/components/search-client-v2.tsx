"use client";

import Link from "next/link";
import { Search, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ProductCard } from "@/components/product-card";
import type { ProductDTO } from "@/lib/products";

const SORTS = [
  { value: "rank", label: "Best match" },
  { value: "newest", label: "Newest" },
  { value: "popularity", label: "Popular" },
];

const PENDING_KEY = "df_pending_saved_search_v2";

function cleanFilters(raw: Record<string, string>) {
  return Object.fromEntries(Object.entries(raw).filter(([, value]) => value.trim() !== ""));
}

function isPublicProduct(product: ProductDTO) {
  const internalCertification =
    product.specifications.internalCertification === "true" ||
    product.specifications.internalCertification === true;
  return !internalCertification && product.availability !== "out_of_stock";
}

export function SearchClientV2({
  initialItems,
  initialTotal,
  categories,
  brands,
}: {
  initialItems: ProductDTO[];
  initialTotal: number;
  categories: { slug: string; name: string }[];
  brands: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(searchParams.get("q") || "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const items = useMemo(() => initialItems.filter(isPublicProduct), [initialItems]);
  const filters = useMemo(
    () => ({
      category: searchParams.get("category") || "",
      brand: searchParams.get("brand") || "",
      sort: searchParams.get("sort") || "rank",
    }),
    [searchParams],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      if (q === (searchParams.get("q") || "")) return;
      const params = new URLSearchParams(searchParams.toString());
      if (q.trim()) params.set("q", q.trim());
      else params.delete("q");
      startTransition(() => router.push(`/search?${params.toString()}`));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, router, searchParams]);

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    startTransition(() => router.push(`/search?${params.toString()}`));
  }

  function clearFilters() {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    startTransition(() => router.push(`/search?${params.toString()}`));
  }

  async function saveSearch() {
    setSaveState("saving");
    const payload = { query: q.trim(), filters: cleanFilters(filters) };
    try {
      const res = await fetch("/api/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify(payload));
        const current = `/search?${new URLSearchParams({ ...(q.trim() ? { q: q.trim() } : {}), ...cleanFilters(filters) }).toString()}`;
        window.location.href = `/login?next=${encodeURIComponent(current)}`;
        return;
      }
      setSaveState(res.ok ? "saved" : "error");
    } catch {
      setSaveState("error");
    }
  }

  const activeFilters = Number(Boolean(filters.category)) + Number(Boolean(filters.brand));

  return (
    <div>
      <div className="sticky top-16 z-30 -mx-4 border-b border-card-border bg-background/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-forest-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search products or brands…"
              className="w-full rounded-2xl border border-card-border bg-card py-3 pl-10 pr-4 text-sm outline-none ring-forest focus:ring-2"
            />
          </div>
          <button
            type="button"
            onClick={() => setFiltersOpen((value) => !value)}
            className="inline-flex items-center gap-2 rounded-2xl border border-card-border bg-card px-4 text-sm font-semibold text-forest-ink md:hidden"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters{activeFilters ? ` (${activeFilters})` : ""}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[220px_1fr]">
        <aside className={`${filtersOpen ? "block" : "hidden"} dn-card h-fit space-y-4 p-4 lg:block`}>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-forest-ink">Refine</h2>
            {activeFilters > 0 && (
              <button type="button" onClick={clearFilters} className="text-xs font-semibold text-forest hover:underline">
                Clear
              </button>
            )}
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-forest-muted">Category</span>
            <select value={filters.category} onChange={(e) => setFilter("category", e.target.value)} className="w-full rounded-xl border border-card-border bg-background px-3 py-2">
              <option value="">All categories</option>
              {categories.map((category) => <option key={category.slug} value={category.slug}>{category.name}</option>)}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-forest-muted">Brand</span>
            <select value={filters.brand} onChange={(e) => setFilter("brand", e.target.value)} className="w-full rounded-xl border border-card-border bg-background px-3 py-2">
              <option value="">All brands</option>
              {brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
            </select>
          </label>

          <button type="button" onClick={saveSearch} disabled={saveState === "saving"} className="w-full rounded-xl border border-card-border py-2 text-sm font-medium text-forest hover:bg-forest/5 disabled:opacity-60">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Try saving again" : "Save this search"}
          </button>
          {saveState === "saved" && <Link href="/dashboard/searches" className="block text-center text-xs font-medium text-forest hover:underline">View saved searches</Link>}
        </aside>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-forest-ink">{pending ? "Updating…" : `${items.length} products shown`}</p>
              <p className="text-xs text-forest-muted">From {initialTotal.toLocaleString()} catalog matches</p>
            </div>
            <label className="text-sm">
              <span className="sr-only">Sort products</span>
              <select value={filters.sort} onChange={(e) => setFilter("sort", e.target.value)} className="rounded-xl border border-card-border bg-card px-3 py-2">
                {SORTS.map((sort) => <option key={sort.value} value={sort.value}>{sort.label}</option>)}
              </select>
            </label>
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-xl border border-card-border bg-card/60 px-3 py-2 text-xs text-forest-muted">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-forest" />
            <p>DealForge only shows “In stock” when the listing data is verified and recently refreshed. Other listings ask you to check current retailer availability.</p>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {items.map((product) => <ProductCard key={product.id} product={product} />)}
          </div>

          {items.length === 0 && (
            <div className="mt-10 rounded-2xl border border-card-border bg-card p-8 text-center">
              <p className="font-semibold text-forest-ink">No current matches</p>
              <p className="mt-1 text-sm text-forest-muted">Try a broader category, brand, or search term.</p>
              <button type="button" onClick={clearFilters} className="mt-4 text-sm font-semibold text-forest hover:underline">Clear filters</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
