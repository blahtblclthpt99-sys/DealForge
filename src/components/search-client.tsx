"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Filter, Search, Sparkles, X } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import type { ProductDTO } from "@/lib/products";

const SORTS = [
  { value: "rank", label: "Best match" },
  { value: "newest", label: "Recently added" },
  { value: "popularity", label: "Popularity" },
];

const PENDING_KEY = "df_pending_saved_search";
const LEGACY_COMMERCE_PARAMS = ["minPrice", "maxPrice", "minRating", "minDiscount"];
const MAX_QUERY_LENGTH = 120;

function cleanFilters(raw: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const value = String(v ?? "").trim();
    if (value) out[k] = value.slice(0, 160);
  }
  return out;
}

function normalizeQuery(value: string) {
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").slice(0, MAX_QUERY_LENGTH);
}

export function SearchClient({
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
  const [q, setQ] = useState(normalizeQuery(searchParams.get("q") || ""));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const items = initialItems;
  const total = initialTotal;

  const filters = useMemo(
    () => ({
      category: searchParams.get("category") || "",
      brand: searchParams.get("brand") || "",
      sort: searchParams.get("sort") || "rank",
    }),
    [searchParams],
  );

  const activeFilters = useMemo(() => {
    const chips: Array<{ key: "category" | "brand"; label: string }> = [];
    if (filters.category) {
      chips.push({
        key: "category",
        label: categories.find((category) => category.slug === filters.category)?.name || filters.category,
      });
    }
    if (filters.brand) chips.push({ key: "brand", label: filters.brand });
    return chips;
  }, [categories, filters.brand, filters.category]);

  useEffect(() => {
    const hasLegacyCommerceParams = LEGACY_COMMERCE_PARAMS.some((key) => searchParams.has(key));
    const unsafeSort = !SORTS.some((sort) => sort.value === filters.sort);
    if (!hasLegacyCommerceParams && !unsafeSort) return;

    const params = new URLSearchParams(searchParams.toString());
    for (const key of LEGACY_COMMERCE_PARAMS) params.delete(key);
    if (unsafeSort) params.set("sort", "rank");
    startTransition(() => router.replace(`/search?${params.toString()}`));
  }, [filters.sort, router, searchParams]);

  useEffect(() => {
    const normalized = normalizeQuery(q).trim();
    const current = normalizeQuery(searchParams.get("q") || "").trim();
    const timer = setTimeout(() => {
      if (normalized === current) return;
      const params = new URLSearchParams(searchParams.toString());
      for (const key of LEGACY_COMMERCE_PARAMS) params.delete(key);
      if (normalized) params.set("q", normalized);
      else params.delete("q");
      const next = params.toString();
      startTransition(() => router.replace(next ? `/search?${next}` : "/search"));
    }, 320);
    return () => clearTimeout(timer);
  }, [q, router, searchParams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = sessionStorage.getItem(PENDING_KEY);
        if (!raw) return;
        const payload = JSON.parse(raw) as { query?: string; filters?: Record<string, string> };
        sessionStorage.removeItem(PENDING_KEY);
        setSaveState("saving");
        const res = await fetch("/api/saved-searches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: normalizeQuery(payload.query || "").trim(),
            filters: cleanFilters(payload.filters || {}),
          }),
        });
        if (cancelled) return;
        if (res.status === 401) {
          setSaveState("idle");
          return;
        }
        setSaveState(res.ok ? "saved" : "error");
      } catch {
        if (!cancelled) setSaveState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    for (const legacy of LEGACY_COMMERCE_PARAMS) params.delete(legacy);
    if (value) params.set(key, value.slice(0, 160));
    else params.delete(key);
    startTransition(() => router.replace(`/search?${params.toString()}`));
  }

  function clearAll() {
    setQ("");
    startTransition(() => router.replace("/search"));
  }

  function currentSearchPath() {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of LEGACY_COMMERCE_PARAMS) params.delete(key);
    const query = normalizeQuery(q).trim();
    if (query) params.set("q", query);
    else params.delete("q");
    const qs = params.toString();
    return qs ? `/search?${qs}` : "/search";
  }

  async function saveSearch() {
    setSaveState("saving");
    const payload = {
      query: normalizeQuery(q).trim(),
      filters: cleanFilters(filters),
    };
    try {
      const res = await fetch("/api/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify(payload));
        window.location.href = `/login?next=${encodeURIComponent(currentSearchPath())}`;
        return;
      }
      if (!res.ok) {
        setSaveState("error");
        return;
      }
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  const saveLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "saved"
        ? "Saved"
        : saveState === "error"
          ? "Try saving again"
          : "Save this search";

  const filterFields = (
    <>
      <div>
        <h2 className="font-semibold text-forest-ink">Refine results</h2>
        <p className="mt-1 text-xs leading-relaxed text-forest-muted">
          Narrow by trusted catalog metadata. Price, discount, rating, and availability filters stay off until an approved source verifies them.
        </p>
      </div>

      <label className="block text-sm">
        <span className="mb-1.5 block font-medium text-forest-muted">Category</span>
        <select
          value={filters.category}
          onChange={(event) => setFilter("category", event.target.value)}
          className="min-h-11 w-full rounded-xl border border-card-border bg-background px-3 py-2 outline-none focus:border-forest/50 focus:ring-2 focus:ring-forest/15"
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>{category.name}</option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="mb-1.5 block font-medium text-forest-muted">Brand</span>
        <select
          value={filters.brand}
          onChange={(event) => setFilter("brand", event.target.value)}
          className="min-h-11 w-full rounded-xl border border-card-border bg-background px-3 py-2 outline-none focus:border-forest/50 focus:ring-2 focus:ring-forest/15"
        >
          <option value="">All brands</option>
          {brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
        </select>
      </label>

      <button
        type="button"
        onClick={saveSearch}
        disabled={saveState === "saving"}
        className="min-h-11 w-full rounded-xl border border-card-border px-4 py-2.5 text-sm font-semibold text-forest transition hover:bg-forest/5 disabled:opacity-60"
      >
        {saveLabel}
      </button>
      {saveState === "saved" && (
        <p className="text-center text-xs text-forest-muted">
          Stored in <Link href="/dashboard/searches" className="font-semibold text-forest hover:underline">Saved searches</Link>
        </p>
      )}
      {saveState === "error" && <p className="text-center text-xs text-red-600">Couldn’t save this search.</p>}
    </>
  );

  return (
    <div>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {[
          ["01", "Describe it", "Search the product, use case, brand, or category you actually want."],
          ["02", "Refine it", "Narrow the catalog with verified category and brand metadata."],
          ["03", "Check retailer", "Open the retailer yourself to confirm the current offer before checkout."],
        ].map(([step, title, copy]) => (
          <div key={step} className="dn-card p-4">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#F97316]">{step}</span>
            <p className="mt-1 font-semibold text-forest-ink">{title}</p>
            <p className="mt-1 text-xs leading-5 text-forest-muted">{copy}</p>
          </div>
        ))}
      </div>

      <div className="mb-6 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {categories.slice(0, 8).map((category) => (
          <button
            key={category.slug}
            type="button"
            onClick={() => setFilter("category", filters.category === category.slug ? "" : category.slug)}
            className={`min-h-10 shrink-0 rounded-full border px-4 text-sm font-semibold transition ${
              filters.category === category.slug
                ? "border-[#F97316] bg-[#F97316] text-white"
                : "border-card-border bg-card text-forest-muted hover:border-[#F97316]/40 hover:text-forest-ink"
            }`}
          >
            {category.name}
          </button>
        ))}
      </div>

      <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="dn-card hidden h-fit space-y-5 p-5 lg:block">{filterFields}</aside>

        <div className="min-w-0">
          <div className="dn-card p-3 sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-forest-muted" />
                <input
                  value={q}
                  onChange={(event) => setQ(normalizeQuery(event.target.value))}
                  maxLength={MAX_QUERY_LENGTH}
                  inputMode="search"
                  autoComplete="off"
                  aria-label="Search products"
                  placeholder="Try ‘cordless drill’, ‘noise cancelling headphones’, or a brand…"
                  className="min-h-12 w-full rounded-xl border border-card-border bg-background py-3 pl-10 pr-4 text-sm outline-none transition focus:border-[#F97316]/60 focus:ring-2 focus:ring-[#F97316]/15"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFiltersOpen((open) => !open)}
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-card-border px-3 text-sm font-semibold text-forest-ink lg:hidden"
                  aria-expanded={filtersOpen}
                >
                  <Filter className="h-4 w-4" /> Filters{activeFilters.length ? ` (${activeFilters.length})` : ""}
                </button>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <span className="sr-only">Sort results</span>
                  <select
                    value={SORTS.some((sort) => sort.value === filters.sort) ? filters.sort : "rank"}
                    onChange={(event) => setFilter("sort", event.target.value)}
                    className="h-11 rounded-xl border border-card-border bg-background px-3 text-sm font-medium outline-none focus:border-[#F97316]/60"
                  >
                    {SORTS.map((sort) => <option key={sort.value} value={sort.value}>{sort.label}</option>)}
                  </select>
                </label>
              </div>
            </div>

            {filtersOpen && <div className="mt-3 space-y-5 border-t border-card-border pt-4 lg:hidden">{filterFields}</div>}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-forest-muted">
                {pending ? "Updating results…" : `${total.toLocaleString()} results`}
              </span>
              {activeFilters.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setFilter(chip.key, "")}
                  className="inline-flex min-h-8 items-center gap-1 rounded-full bg-forest/8 px-3 text-xs font-semibold text-forest"
                >
                  {chip.label}<X className="h-3 w-3" />
                </button>
              ))}
              {(q.trim() || activeFilters.length > 0) && (
                <button type="button" onClick={clearAll} className="ml-auto text-xs font-semibold text-[#F97316] hover:underline">
                  Clear all
                </button>
              )}
            </div>
          </div>

          {items.length > 0 ? (
            <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
              {items.map((product) => <ProductCard key={product.id} product={product} />)}
            </div>
          ) : (
            <div className="dn-card mt-5 px-5 py-12 text-center">
              <Sparkles className="mx-auto h-6 w-6 text-[#F97316]" />
              <h2 className="mt-3 font-display text-2xl font-semibold text-forest-ink">No match yet</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-forest-muted">
                Try a broader product name, remove a filter, or search by the job the product needs to do.
              </p>
              <button type="button" onClick={clearAll} className="mt-5 rounded-full bg-[#F97316] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#EA580C]">
                Reset product finder
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
