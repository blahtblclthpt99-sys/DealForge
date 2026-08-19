"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductDTO } from "@/lib/products";
import { ProductCard } from "./product-card";

type FeedResponse = {
  items: ProductDTO[];
  hasMore: boolean;
  page: number;
};

export function InfiniteProductFeed({
  initial,
  query = {},
  excludeIds = [],
}: {
  initial: FeedResponse;
  query?: Record<string, string | number | boolean | undefined>;
  excludeIds?: string[];
}) {
  const excluded = new Set(excludeIds);
  const [items, setItems] = useState(() => initial.items.filter((p) => !excluded.has(p.id)));
  const [page, setPage] = useState(initial.page);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const seenIds = useRef(
    new Set<string>([
      ...excludeIds,
      ...initial.items.map((product) => product.id),
    ]),
  );

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(query).forEach(([k, v]) => {
        if (v !== undefined && v !== "") params.set(k, String(v));
      });
      params.set("page", String(page + 1));
      params.set("limit", "24");
      const res = await fetch(`/api/products?${params.toString()}`);
      if (!res.ok) throw new Error(`Product feed request failed (${res.status})`);

      const data = (await res.json()) as FeedResponse;
      const uniqueItems = data.items.filter((product) => {
        if (seenIds.current.has(product.id)) return false;
        seenIds.current.add(product.id);
        return true;
      });

      setItems((prev) => [...prev, ...uniqueItems]);
      setPage(data.page);
      setHasMore(data.hasMore);
    } catch (error) {
      console.error("Failed to load more products", error);
    } finally {
      setLoading(false);
    }
  }, [hasMore, loading, page, query]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
        {items.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
      <div ref={sentinel} className="flex justify-center py-10">
        {loading && <p className="text-sm text-forest-muted">Loading more deals…</p>}
        {!hasMore && items.length > 0 && (
          <p className="text-sm text-forest-muted">You&apos;ve reached the end.</p>
        )}
      </div>
    </div>
  );
}
