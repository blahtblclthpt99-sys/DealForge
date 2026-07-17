"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buildAmazonImageUrls } from "@/lib/affiliate/amazon-config";
import {
  normalizeProductImage,
  productImagePlaceholder,
  proxiedProductImage,
} from "@/lib/product-image";

const MAX_IN_FLIGHT = 8;
let inFlight = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<() => void> {
  return new Promise((resolve) => {
    const tryStart = () => {
      if (inFlight >= MAX_IN_FLIGHT) {
        waiters.push(tryStart);
        return;
      }
      inFlight += 1;
      let done = false;
      resolve(() => {
        if (done) return;
        done = true;
        inFlight = Math.max(0, inFlight - 1);
        const next = waiters.shift();
        if (next) next();
      });
    };
    tryStart();
  });
}

export function ProductImage({
  src,
  alt,
  className,
  priority = false,
  asin,
}: {
  src?: string | null;
  alt: string;
  className?: string;
  priority?: boolean;
  asin?: string | null;
}) {
  const placeholder = productImagePlaceholder();

  const candidates = useMemo(() => {
    const list: string[] = [];
    const seen = new Set<string>();
    const push = (u: string) => {
      if (!u || seen.has(u)) return;
      seen.add(u);
      list.push(u);
    };

    const primary = normalizeProductImage(src);
    if (primary && primary !== placeholder) push(proxiedProductImage(primary));
    if (asin) {
      for (const u of buildAmazonImageUrls(asin, [500])) {
        push(proxiedProductImage(u));
      }
    }
    push(placeholder);
    return list;
  }, [src, asin, placeholder]);

  const [index, setIndex] = useState(0);
  const current = candidates[Math.min(index, candidates.length - 1)]!;
  const skipQueue = priority || current === placeholder;
  const imgRef = useRef<HTMLImageElement>(null);
  const releaseRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    let cancelled = false;

    if (skipQueue) {
      img.src = current;
      return;
    }

    img.src = placeholder;

    (async () => {
      const release = await acquire();
      if (cancelled) {
        release();
        return;
      }
      releaseRef.current = release;
      if (imgRef.current) imgRef.current.src = current;
    })();

    return () => {
      cancelled = true;
      releaseRef.current?.();
      releaseRef.current = null;
    };
  }, [current, placeholder, skipQueue]);

  function finishSlot() {
    releaseRef.current?.();
    releaseRef.current = null;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src={skipQueue ? current : placeholder}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      referrerPolicy="no-referrer"
      onLoad={(e) => {
        if ((e.currentTarget.src || "").includes("/api/img")) finishSlot();
      }}
      onError={() => {
        finishSlot();
        setIndex((i) => (i + 1 < candidates.length ? i + 1 : i));
      }}
      className={cn("bg-forest-bg", className)}
    />
  );
}
