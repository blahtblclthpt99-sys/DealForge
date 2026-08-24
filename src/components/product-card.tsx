"use client";

import Link from "next/link";
import { CheckCircle2, Clock3, Heart, Star } from "lucide-react";
import { useState } from "react";
import type { ProductDTO } from "@/lib/products";
import { ProductImage } from "@/components/product-image";
import { cn, discountLabel, formatPrice } from "@/lib/utils";
import { formatQuantityLabel } from "@/lib/quantity";

const STOCK_FRESHNESS_MS = 48 * 60 * 60 * 1000;

export function ProductCard({ product, wishlisted = false, onToggleWishlist }: { product: ProductDTO; wishlisted?: boolean; onToggleWishlist?: (id: string) => void }) {
  const [liked, setLiked] = useState(wishlisted);
  const image = product.images[0];
  const amazonUnverified = product.retailer === "amazon" && !product.priceVerified;
  const save = amazonUnverified ? null : discountLabel(product.discountPercent);
  const qnty = formatQuantityLabel(product.quantity);
  const updatedAt = Date.parse(product.lastUpdated);
  const ageMs = Date.now() - updatedAt;
  const recentlyUpdated = Number.isFinite(updatedAt) && ageMs >= 0 && ageMs <= STOCK_FRESHNESS_MS;
  const verifiedInStock = product.metadataVerified && product.availability === "in_stock" && recentlyUpdated;

  async function toggleWish(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = !liked;
    setLiked(next);
    onToggleWishlist?.(product.id);
    try {
      await fetch("/api/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id, action: next ? "add" : "remove" }),
      });
    } catch {
      setLiked(!next);
    }
  }

  return (
    <Link href={`/product/${product.slug}`} className="dn-card group flex flex-col overflow-hidden transition duration-300 hover:-translate-y-1 hover:shadow-lg">
      <div className="relative aspect-square overflow-hidden bg-forest-bg">
        <ProductImage src={image} alt={product.title} asin={product.asin} className="h-full w-full object-contain p-3 transition duration-500 group-hover:scale-105" />
        {save && <span className="absolute left-3 top-3 rounded-full bg-forest px-2.5 py-1 text-xs font-semibold text-white">{save}</span>}
        <button type="button" onClick={toggleWish} aria-label="Toggle wishlist" className={cn("absolute right-3 top-3 rounded-full bg-card/90 p-2 shadow-sm backdrop-blur transition", liked ? "text-red-500" : "text-forest-muted hover:text-forest")}>
          <Heart className={cn("h-4 w-4", liked && "fill-current")} />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-forest-muted">{product.brand}{qnty ? <span className="text-forest"> · {qnty}</span> : null}</p>
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-forest-ink">{product.title}</h3>
        <div className="flex items-center gap-1.5 text-[11px] font-medium">
          {verifiedInStock ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-forest/10 px-2 py-1 text-forest">
              <CheckCircle2 className="h-3 w-3" /> In stock
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-card-border px-2 py-1 text-forest-muted">
              <Clock3 className="h-3 w-3" /> Check availability
            </span>
          )}
        </div>
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div>
            {amazonUnverified ? (
              <p className="text-sm font-bold leading-snug text-forest">Check price & availability</p>
            ) : (
              <>
                <p className="text-lg font-bold text-forest">{formatPrice(product.price)}</p>
                {product.originalPrice > product.price && <p className="text-xs text-forest-muted line-through">{formatPrice(product.originalPrice)}</p>}
              </>
            )}
          </div>
          {product.metadataVerified && product.rating > 0 ? (
            <div className="flex items-center gap-1 text-xs text-forest-muted">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              <span>{product.rating.toFixed(1)}</span>
              <span>({product.reviewCount.toLocaleString()})</span>
            </div>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
