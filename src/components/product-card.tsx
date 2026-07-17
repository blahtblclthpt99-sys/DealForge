"use client";

import Link from "next/link";
import { Heart, Star } from "lucide-react";
import { useState } from "react";
import type { ProductDTO } from "@/lib/products";
import { ProductImage } from "@/components/product-image";
import { cn, discountLabel, formatPrice } from "@/lib/utils";

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
  const save = discountLabel(product.discountPercent);

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
    <Link
      href={`/product/${product.slug}`}
      className="dn-card group flex flex-col overflow-hidden transition duration-300 hover:-translate-y-1 hover:shadow-lg"
    >
      <div className="relative aspect-square overflow-hidden bg-forest-bg">
        <ProductImage
          src={image}
          alt={product.title}
          className="h-full w-full object-contain p-3 transition duration-500 group-hover:scale-105"
        />
        {save && (
          <span className="absolute left-3 top-3 rounded-full bg-forest px-2.5 py-1 text-xs font-semibold text-white">
            {save}
          </span>
        )}
        <button
          type="button"
          onClick={toggleWish}
          aria-label="Toggle wishlist"
          className={cn(
            "absolute right-3 top-3 rounded-full bg-card/90 p-2 shadow-sm backdrop-blur transition",
            liked ? "text-red-500" : "text-forest-muted hover:text-forest",
          )}
        >
          <Heart className={cn("h-4 w-4", liked && "fill-current")} />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-forest-muted">
          {product.brand}
        </p>
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-forest-ink">
          {product.title}
        </h3>
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div>
            <p className="text-lg font-bold text-forest">{formatPrice(product.price)}</p>
            {product.originalPrice > product.price && (
              <p className="text-xs text-forest-muted line-through">
                {formatPrice(product.originalPrice)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs text-forest-muted">
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
            <span>{product.rating.toFixed(1)}</span>
            <span>({product.reviewCount.toLocaleString()})</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
