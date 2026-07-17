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
}: {
  initial: FeedResponse;
  query?: Record<string, string | number | boolean | undefined>;
}) {
  const [items, setItems] = useState(initial.items);
  const [page, setPage] = useState(initial.page);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement | null>(null);

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
      const data = (await res.json()) as FeedResponse;
      setItems((prev) => [...prev, ...data.items]);
      setPage(data.page);
      setHasMore(data.hasMore);
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
