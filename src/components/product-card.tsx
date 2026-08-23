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
  const sourceRetailer = retailerLabel(product.retailer);
  const seller = commerce.sellerLabel;
  const canShowRecorded =
    !commerce.isDirectCommerce &&
    !commerce.canDisplayPrice &&
    product.recordedPriceAvailable &&
    product.recordedPrice > 0;

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
    <article className="dn-card group flex min-w-0 flex-col overflow-hidden transition duration-300 hover:-translate-y-1 hover:shadow-xl">
      <div className="relative aspect-square overflow-hidden bg-[linear-gradient(145deg,var(--card),var(--forest-bg))]">
        <Link href={`/product/${product.slug}`} aria-label={product.title} className="block h-full w-full">
          <ProductImage
            src={image}
            alt={product.title}
            asin={product.asin}
            className="h-full w-full object-contain p-4 transition duration-500 group-hover:scale-[1.04]"
          />
        </Link>
        <div className="absolute left-3 top-3 flex max-w-[74%] flex-wrap gap-1.5">
          <span className="rounded-full border border-card-border/70 bg-card/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-forest-ink shadow-sm backdrop-blur">
            {seller}
          </span>
          {commerce.isDirectCommerce && commerce.canPurchaseDirect ? (
            <span className="rounded-full bg-forest px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
              Direct checkout
            </span>
          ) : null}
          {!commerce.isDirectCommerce && commerce.isAmazon && commerce.priceStatus === "recorded" ? (
            <span className="rounded-full border border-card-border bg-card/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-forest-muted shadow-sm backdrop-blur">
              Recorded price
            </span>
          ) : null}
          {save ? (
            <span className="rounded-full bg-[#F97316] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
              {save}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={toggleWish}
          aria-label={liked ? "Remove from wishlist" : "Add to wishlist"}
          className={cn(
            "absolute right-3 top-3 rounded-full border border-card-border/70 bg-card/90 p-2.5 shadow-sm backdrop-blur transition hover:scale-105",
            liked ? "text-red-500" : "text-forest-muted hover:text-forest",
          )}
        >
          <Heart className={cn("h-4 w-4", liked && "fill-current")} />
        </button>
      </div>

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <p className="min-h-4 truncate text-[10px] font-bold uppercase tracking-[0.14em] text-forest-muted">
          {product.brand || seller}
          {qnty ? <span className="text-forest"> · {qnty}</span> : null}
        </p>
        <Link href={`/product/${product.slug}`} className="mt-1.5">
          <h3 className="line-clamp-2 min-h-10 text-sm font-semibold leading-snug text-forest-ink transition group-hover:text-forest">
            {product.title}
          </h3>
        </Link>

        <div className="mt-3 min-h-[3.6rem]">
          {commerce.canDisplayPrice && commerce.displayPrice != null ? (
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <p className="text-xl font-extrabold tracking-tight text-forest">
                {formatPrice(commerce.displayPrice)}
              </p>
              {commerce.canDisplayDiscount ? (
                <p className="text-xs text-forest-muted line-through">{formatPrice(product.originalPrice)}</p>
              ) : null}
            </div>
          ) : canShowRecorded ? (
            <div>
              <div className="flex flex-wrap items-baseline gap-2">
                <p className="text-xl font-extrabold tracking-tight text-forest">
                  {formatPrice(product.recordedPrice)}
                </p>
                <span className="text-[10px] font-bold uppercase tracking-wide text-forest-muted">recorded</span>
              </div>
              <p className="mt-0.5 text-[10px] font-semibold text-[#F97316]">Verify current price at {sourceRetailer}</p>
            </div>
          ) : (
            <p className="text-sm font-bold text-forest">
              {commerce.isDirectCommerce ? "Temporarily unavailable" : `Check current price on ${sourceRetailer}`}
            </p>
          )}
          <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-forest-muted/75">
            {commerce.priceCaption}
          </p>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-card-border/70 pt-3">
          {product.rating > 0 ? (
            <div className="flex min-w-0 items-center gap-1 text-xs text-forest-muted">
              <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
              <span className="font-semibold text-forest-ink">{product.rating.toFixed(1)}</span>
              {commerce.reviewCountIsCredible ? (
                <span className="truncate">({product.reviewCount.toLocaleString()})</span>
              ) : null}
            </div>
          ) : (
            <span className="text-[10px] font-medium uppercase tracking-wide text-forest-muted">
              {commerce.isDirectCommerce ? "Sold by DealForge" : "Shop listing"}
            </span>
          )}
          <Link
            href={`/product/${product.slug}`}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-forest hover:underline"
          >
            {commerce.canPurchaseDirect ? "Buy deal" : "View deal"} <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </article>
  );
}
