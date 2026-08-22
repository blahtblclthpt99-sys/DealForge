"use client";

import Link from "next/link";
import { ArrowUpRight, Heart, Star } from "lucide-react";
import { useState } from "react";
import type { ProductDTO } from "@/lib/products";
import { ProductImage } from "@/components/product-image";
import { cn, discountLabel, formatPrice } from "@/lib/utils";
import { formatQuantityLabel } from "@/lib/quantity";
import { getCommerceDisplayState, retailerLabel } from "@/lib/commerce-display";

export function ProductCard({
  product,
  wishlisted = false,
  onToggleWishlist,
}: {
  product: ProductDTO;
  wishlisted?: boolean;
  onToggleWishlist?: (id: string) => void;
}) {
  const [liked, setLiked] = useState(wishlisted);
  const image = product.images[0];
  const commerce = getCommerceDisplayState(product);
  const save = commerce.canDisplayDiscount ? discountLabel(product.discountPercent) : null;
  const qnty = formatQuantityLabel(product.quantity);
  const retailer = retailerLabel(product.retailer);
  const canShowRecorded = !commerce.canDisplayPrice && product.recordedPriceAvailable && product.recordedPrice > 0;

  async function toggleWish(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = !liked;
    setLiked(next);
    onToggleWishlist?.(product.id);
    try {
      const res = await fetch("/api/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id, action: next ? "add" : "remove" }),
      });
      if (!res.ok) setLiked(!next);
    } catch {
      setLiked(!next);
    }
  }

  return (
    <article className="dn-card dn-card-interactive group flex min-w-0 flex-col overflow-hidden">
      <div className="relative aspect-square overflow-hidden bg-[linear-gradient(145deg,var(--card),var(--forest-bg))]">
        <Link href={`/product/${product.slug}`} aria-label={`View ${product.title}`} className="block h-full w-full">
          <ProductImage
            src={image}
            alt={product.title}
            asin={product.asin}
            className="h-full w-full object-contain p-4 transition duration-500 group-hover:scale-[1.035] sm:p-5"
          />
        </Link>

        <div className="absolute left-2.5 top-2.5 flex max-w-[72%] flex-wrap gap-1.5 sm:left-3 sm:top-3">
          <span className="rounded-full border border-card-border/70 bg-card/92 px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.12em] text-forest-ink shadow-sm backdrop-blur sm:text-[10px]">
            {retailer}
          </span>
          {commerce.isAmazon && commerce.priceStatus === "recorded" ? (
            <span className="rounded-full border border-amber-500/20 bg-amber-50/95 px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-wide text-amber-800 shadow-sm backdrop-blur dark:bg-amber-950/60 dark:text-amber-200 sm:text-[10px]">
              Recorded
            </span>
          ) : null}
          {save ? (
            <span className="rounded-full bg-[#F97316] px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-wide text-white shadow-sm sm:text-[10px]">
              {save}
            </span>
          ) : null}
        </div>

        <button
          type="button"
          onClick={toggleWish}
          aria-label={liked ? `Remove ${product.title} from wishlist` : `Add ${product.title} to wishlist`}
          aria-pressed={liked}
          className={cn(
            "absolute right-2.5 top-2.5 inline-flex h-11 w-11 items-center justify-center rounded-full border border-card-border/70 bg-card/92 shadow-sm backdrop-blur transition hover:scale-105 sm:right-3 sm:top-3",
            liked ? "text-red-500" : "text-forest-muted hover:text-forest",
          )}
        >
          <Heart className={cn("h-4 w-4", liked && "fill-current")} />
        </button>
      </div>

      <div className="flex flex-1 flex-col p-3.5 sm:p-5">
        <p className="min-h-4 truncate text-[10px] font-extrabold uppercase tracking-[0.13em] text-forest-muted">
          {product.brand || retailer}
          {qnty ? <span className="text-forest"> · {qnty}</span> : null}
        </p>

        <Link href={`/product/${product.slug}`} className="mt-1.5 rounded-md">
          <h3 className="line-clamp-2 min-h-10 text-[13px] font-bold leading-snug text-forest-ink transition group-hover:text-forest sm:text-sm">
            {product.title}
          </h3>
        </Link>

        <div className="mt-3 min-h-[4.25rem]">
          {commerce.canDisplayPrice ? (
            <div>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <p className="text-xl font-extrabold tracking-tight text-forest sm:text-2xl">
                  {formatPrice(product.price)}
                </p>
                {commerce.canDisplayDiscount ? (
                  <p className="text-xs text-forest-muted line-through">{formatPrice(product.originalPrice)}</p>
                ) : null}
              </div>
              <p className="mt-1 line-clamp-2 text-[10px] font-medium leading-relaxed text-forest-muted/80">
                {commerce.priceCaption}
              </p>
            </div>
          ) : canShowRecorded ? (
            <div>
              <div className="flex flex-wrap items-baseline gap-2">
                <p className="text-xl font-extrabold tracking-tight text-forest sm:text-2xl">
                  {formatPrice(product.recordedPrice)}
                </p>
                <span className="text-[9px] font-extrabold uppercase tracking-wide text-forest-muted">recorded</span>
              </div>
              <p className="mt-1 text-[10px] font-bold leading-relaxed text-[#F97316]">Verify current price at {retailer}</p>
            </div>
          ) : (
            <div>
              <p className="text-sm font-extrabold text-forest">Check current price</p>
              <p className="mt-1 text-[10px] leading-relaxed text-forest-muted/80">Open {retailer} for the current offer and availability.</p>
            </div>
          )}
        </div>

        <div className="mt-auto flex min-h-11 items-center justify-between gap-2 border-t border-card-border/70 pt-3">
          {product.rating > 0 ? (
            <div className="flex min-w-0 items-center gap-1 text-xs text-forest-muted" aria-label={`${product.rating.toFixed(1)} star rating`}>
              <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" aria-hidden="true" />
              <span className="font-bold text-forest-ink">{product.rating.toFixed(1)}</span>
              {commerce.reviewCountIsCredible ? <span className="truncate">({product.reviewCount.toLocaleString()})</span> : null}
            </div>
          ) : (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-forest-muted">Retailer listing</span>
          )}

          <Link
            href={`/product/${product.slug}`}
            className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-extrabold text-forest transition hover:bg-forest/8"
          >
            View <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </article>
  );
}
