"use client";

import { ExternalLink } from "lucide-react";
import { retailerLabel } from "@/lib/commerce-display";

export function BuyButton({
  productId,
  retailer = "amazon",
  priceNeedsCheck = false,
}: {
  productId: string;
  retailer?: string;
  priceNeedsCheck?: boolean;
  /** @deprecated Links are built live via /go/[productId] */
  affiliateUrl?: string;
}) {
  const href = `/go/${productId}`;
  const store = retailerLabel(retailer);
  const label = priceNeedsCheck ? `Check price on ${store}` : `View on ${store}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer sponsored nofollow"
      className="inline-flex min-h-12 items-center gap-2 rounded-full bg-forest px-6 py-3 text-sm font-bold text-white shadow-md transition hover:-translate-y-0.5 hover:bg-forest-dark hover:shadow-lg"
    >
      {label} <ExternalLink className="h-4 w-4" />
    </a>
  );
}
