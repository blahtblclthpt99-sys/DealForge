"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductDTO } from "@/lib/products";
import { publicCatalogItems } from "@/lib/public-catalog";
import { ProductCard } from "./product-card";

type FeedResponse = { items: ProductDTO[]; hasMore: boolean; page: number };

export function InfiniteProductFeed({ initial, query = {} }: { initial: FeedResponse; query?: Record<string, string | number | boolean | undefined> }) {
  const [items, setItems] = useState(() => publicCatalogItems(initial.items));
  const [page, setPage] = useState(initial.page);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(query).forEach(([key, value]) => { if (value !== undefined && value !== "") params.set(key, String(value)); });
      params.set("page", String(page + 1));
      params.set("limit", "24");
      const res = await fetch(`/api/products?${params.toString()}`);
      if (!res.ok) throw new Error("PRODUCT_FEED_UNAVAILABLE");
      const data = (await res.json()) as FeedResponse;
      setItems((previous) => {
        const incoming = publicCatalogItems(data.items);
        const seen = new Set(previous.map((product) => product.id));
        return [...previous, ...incoming.filter((product) => !seen.has(product.id))];
      });
      setPage(data.page);
      setHasMore(data.hasMore);
    } finally {
      setLoading(false);
    }
  }, [hasMore, loading, page, query]);

  useEffect(() => {
    const element = sentinel.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) void loadMore(); }, { rootMargin: "400px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [loadMore]);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">{items.map((product) => <ProductCard key={product.id} product={product} />)}</div>
      <div ref={sentinel} className="flex justify-center py-10">
        {loading && <p className="text-sm text-forest-muted">Loading more products…</p>}
        {!hasMore && items.length > 0 && <p className="text-sm text-forest-muted">You&apos;ve reached the end.</p>}
      </div>
    </div>
  );
}
