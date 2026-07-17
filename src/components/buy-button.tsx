"use client";

import { ExternalLink } from "lucide-react";

const LABELS: Record<string, string> = {
  amazon: "Buy on Amazon",
  ebay: "Buy on eBay",
  aliexpress: "Buy on AliExpress",
  walmart: "Buy on Walmart",
};

export function BuyButton({
  productId,
  retailer = "amazon",
}: {
  productId: string;
  retailer?: string;
  /** @deprecated Links are built live via /go/[productId] */
  affiliateUrl?: string;
}) {
  const href = `/go/${productId}`;
  const label = LABELS[retailer] || "Buy on retailer";

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer sponsored nofollow"
      className="inline-flex items-center gap-2 rounded-full bg-forest px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-forest-dark"
    >
      {label} <ExternalLink className="h-4 w-4" />
    </a>
  );
}
