"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ProductCard } from "@/components/product-card";
import type { ProductDTO } from "@/lib/products";

const SORTS = [
  { value: "rank", label: "Best match" },
  { value: "newest", label: "Newest" },
  { value: "rating", label: "Rating" },
  { value: "popularity", label: "Popularity" },
  { value: "savings", label: "Biggest savings" },
  { value: "price_asc", label: "Lowest price" },
  { value: "price_desc", label: "Highest price" },
];

const PENDING_KEY = "df_pending_saved_search";

function cleanFilters(raw: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v != null && String(v).trim() !== "") out[k] = String(v);
  }
  return out;
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
  const [q, setQ] = useState(searchParams.get("q") || "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const items = initialItems;
  const total = initialTotal;

  const filters = useMemo(
    () => ({
      category: searchParams.get("category") || "",
      brand: searchParams.get("brand") || "",
      minPrice: searchParams.get("minPrice") || "",
      maxPrice: searchParams.get("maxPrice") || "",
      minRating: searchParams.get("minRating") || "",
      minDiscount: searchParams.get("minDiscount") || "",
      sort: searchParams.get("sort") || "rank",
    }),
    [searchParams],
  );

  useEffect(() => {
    const t = setTimeout(() => {
      if (q === (searchParams.get("q") || "")) return;
      const params = new URLSearchParams(searchParams.toString());
      if (q) params.set("q", q);
      else params.delete("q");
      startTransition(() => router.push(`/search?${params.toString()}`));
    }, 280);
    return () => clearTimeout(t);
  }, [q, router, searchParams]);

  // After login redirect, finish a pending save
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
            query: payload.query || "",
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
    if (value) params.set(key, value);
    else params.delete(key);
    startTransition(() => router.push(`/search?${params.toString()}`));
  }

  function currentSearchPath() {
    const params = new URLSearchParams(searchParams.toString());
    if (q) params.set("q", q);
    else params.delete("q");
    const qs = params.toString();
    return qs ? `/search?${qs}` : "/search";
  }

  async function saveSearch() {
    setSaveState("saving");
    const payload = {
      query: q,
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
        ? "Saved!"
        : saveState === "error"
          ? "Couldn’t save — try again"
          : "Save this search";

  return (
    <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
      <aside className="dn-card h-fit space-y-4 p-5">
        <h2 className="font-semibold text-forest-ink">Filters</h2>

        <label className="block text-sm">
          <span className="mb-1 block text-forest-muted">Category</span>
          <select
            value={filters.category}
            onChange={(e) => setFilter("category", e.target.value)}
            className="w-full rounded-xl border border-card-border bg-background px-3 py-2"
          >
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-forest-muted">Brand</span>
          <select
            value={filters.brand}
            onChange={(e) => setFilter("brand", e.target.value)}
            className="w-full rounded-xl border border-card-border bg-background px-3 py-2"
          >
            <option value="">All</option>
            {brands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm">
            <span className="mb-1 block text-forest-muted">Min $</span>
            <input
              type="number"
              value={filters.minPrice}
              onChange={(e) => setFilter("minPrice", e.target.value)}
              className="w-full rounded-xl border border-card-border bg-background px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-forest-muted">Max $</span>
            <input
              type="number"
              value={filters.maxPrice}
              onChange={(e) => setFilter("maxPrice", e.target.value)}
              className="w-full rounded-xl border border-card-border bg-background px-3 py-2"
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block text-forest-muted">Min rating</span>
          <select
            value={filters.minRating}
            onChange={(e) => setFilter("minRating", e.target.value)}
            className="w-full rounded-xl border border-card-border bg-background px-3 py-2"
          >
            <option value="">Any</option>
            <option value="4">4+</option>
            <option value="4.5">4.5+</option>
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-forest-muted">Min discount %</span>
          <select
            value={filters.minDiscount}
            onChange={(e) => setFilter("minDiscount", e.target.value)}
            className="w-full rounded-xl border border-card-border bg-background px-3 py-2"
          >
            <option value="">Any</option>
            <option value="10">10%+</option>
            <option value="20">20%+</option>
            <option value="30">30%+</option>
            <option value="40">40%+</option>
          </select>
        </label>

        <button
          type="button"
          onClick={saveSearch}
          disabled={saveState === "saving"}
          className="w-full rounded-xl border border-card-border py-2 text-sm font-medium text-forest hover:bg-forest/5 disabled:opacity-60"
        >
          {saveLabel}
        </button>
        {saveState === "saved" && (
          <p className="text-center text-xs text-forest-muted">
            View in{" "}
            <Link href="/dashboard/searches" className="font-medium text-forest hover:underline">
              Saved searches
            </Link>
          </p>
        )}
        {saveState === "error" && (
          <p className="text-center text-xs text-red-600">Something went wrong. Please try again.</p>
        )}
      </aside>

      <div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Live search products, brands…"
              className="w-full rounded-2xl border border-card-border bg-card px-4 py-3 text-sm outline-none ring-forest focus:ring-2"
            />
            <p className="mt-2 text-sm text-forest-muted">
              {pending ? "Updating…" : `${total} results`}
            </p>
          </div>
          <label className="text-sm">
            <span className="mr-2 text-forest-muted">Sort</span>
            <select
              value={filters.sort}
              onChange={(e) => setFilter("sort", e.target.value)}
              className="rounded-xl border border-card-border bg-card px-3 py-2"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
          {items.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
        {items.length === 0 && (
          <p className="mt-10 text-center text-forest-muted">No products matched those filters.</p>
        )}
      </div>
    </div>
  );
}
