"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { normalizeProductImage, productImagePlaceholder } from "@/lib/product-image";

export function ProductImage({
  src,
  alt,
  className,
  priority = false,
}: {
  src?: string | null;
  alt: string;
  className?: string;
  priority?: boolean;
}) {
  const placeholder = productImagePlaceholder();
  const initial = normalizeProductImage(src);
  const [current, setCurrent] = useState(initial);
  const [failed, setFailed] = useState(false);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={failed ? placeholder : current}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      // Amazon CDN often 403s when Referer is a third-party / localhost site
      referrerPolicy="no-referrer"
      onError={() => {
        if (failed) return;
        if (src && current !== src && current !== placeholder) {
          setCurrent(src);
          return;
        }
        setFailed(true);
      }}
      className={cn("bg-forest-bg", className)}
    />
  );
}
