"use client";

import Link from "next/link";
import { Heart, Star } from "lucide-react";
import { useState } from "react";
import type { ProductDTO } from "@/lib/products";
import { ProductImage } from "@/components/product-image";
import { QuickAddButton } from "@/components/quick-add-button";
import { cn, discountLabel, formatPrice } from "@/lib/utils";
import { formatQuantityLabel } from "@/lib/quantity";

export function ProductCard({ product, wishlisted = false, onToggleWishlist }: { product: ProductDTO; wishlisted?: boolean; onToggleWishlist?: (id: string) => void }) {
  const [liked, setLiked] = useState(wishlisted);
  const [savingWishlist, setSavingWishlist] = useState(false);
  const image = product.images[0];
  const save = product.priceEstimated ? null : discountLabel(product.discountPercent);
  const qnty = formatQuantityLabel(product.quantity);
  const direct = product.purchaseMode === "direct" && product.commerceReady;
  const verifiedInStock = direct && product.availabilityVerified && product.availability === "in_stock";

  async function toggleWish(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (savingWishlist) return;

    const previous = liked;
    const next = !previous;
    setLiked(next);
    setSavingWishlist(true);

    try {
      const response = await fetch("/api/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id, action: next ? "add" : "remove" }),
      });
      if (!response.ok) throw new Error(`Wishlist update failed (${response.status})`);
      onToggleWishlist?.(product.id);
    } catch {
      setLiked(previous);
    } finally {
      setSavingWishlist(false);
    }
  }

  return (
    <article className="dn-card group flex flex-col overflow-hidden transition duration-300 hover:-translate-y-1 hover:shadow-lg">
      <div className="relative aspect-square overflow-hidden bg-forest-bg">
        <Link href={`/product/${product.slug}`} aria-label={product.title} className="block h-full w-full">
          <ProductImage src={image} alt={product.title} asin={product.asin} className="h-full w-full object-contain p-3 transition duration-500 group-hover:scale-105" />
        </Link>
        {save && <span className="absolute left-3 top-3 rounded-full bg-forest px-2.5 py-1 text-xs font-semibold text-white">{save}</span>}
        <button
          type="button"
          onClick={toggleWish}
          aria-label="Toggle wishlist"
          aria-pressed={liked}
          disabled={savingWishlist}
          className={cn("absolute right-3 top-3 rounded-full bg-card/90 p-2 shadow-sm backdrop-blur transition disabled:cursor-wait disabled:opacity-60", liked ? "text-red-500" : "text-forest-muted hover:text-forest")}
        >
          <Heart className={cn("h-4 w-4", liked && "fill-current")} />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-forest-muted">{product.brand}{qnty ? <span className="text-forest"> · {qnty}</span> : null}</p>
        <Link href={`/product/${product.slug}`} className="line-clamp-2 text-sm font-semibold leading-snug text-forest-ink hover:text-forest">{product.title}</Link>
        {verifiedInStock ? (
          <p className="text-[11px] font-semibold text-forest">In stock · Sold by DealForge</p>
        ) : (
          <p className="text-[11px] font-medium text-forest-muted">Check price &amp; availability at source</p>
        )}
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div>
            {product.price > 0 ? (
              <>
                <p className="text-lg font-bold text-forest">{formatPrice(product.price)}</p>
                {direct ? (
                  <p className="text-[11px] font-medium text-forest-muted">Published ceiling · cart may be lower</p>
                ) : product.priceEstimated ? (
                  <p className="text-[11px] font-medium text-forest-muted">DealForge estimate</p>
                ) : product.originalPrice > product.price ? (
                  <p className="text-xs text-forest-muted line-through">{formatPrice(product.originalPrice)}</p>
                ) : null}
              </>
            ) : (
              <p className="text-sm font-bold text-forest">DealForge estimate pending</p>
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
        {direct ? (
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-card-border pt-3">
            <span className="text-[11px] text-forest-muted">Final price calculated in cart</span>
            <QuickAddButton productId={product.id} />
          </div>
        ) : null}
      </div>
    </article>
  );
}