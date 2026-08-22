"use client";

import { ExternalLink, ShieldCheck } from "lucide-react";
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
  const label = priceNeedsCheck ? `Check current price on ${store}` : `View offer on ${store}`;

  return (
    <div className="flex max-w-xl flex-col gap-2">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer sponsored nofollow"
        className="dn-button-primary min-h-[3.25rem] px-6 text-sm sm:text-[15px]"
        aria-label={`${label}. Opens retailer in a new tab.`}
      >
        {label} <ExternalLink className="h-4 w-4" aria-hidden="true" />
      </a>
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium leading-relaxed text-forest-muted">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-forest" aria-hidden="true" />
        Final price, availability, shipping, and checkout are confirmed by {store}.
      </span>
    </div>
  );
}
