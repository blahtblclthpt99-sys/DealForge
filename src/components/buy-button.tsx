"use client";

import { ExternalLink } from "lucide-react";

function actionLabel(retailer?: string) {
  switch (retailer) {
    case "amazon":
      return "Check on Amazon";
    case "ebay":
      return "Check on eBay";
    case "aliexpress":
      return "Check on AliExpress";
    default:
      return "View retailer";
  }
}

export function BuyButton({
  productId,
  retailer,
}: {
  productId: string;
  retailer?: string;
  /** @deprecated Links are built live via /go/[productId] */
  affiliateUrl?: string;
}) {
  const href = `/go/${productId}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer sponsored nofollow"
      className="inline-flex items-center gap-2 rounded-full bg-forest px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-forest-dark"
    >
      {actionLabel(retailer)} <ExternalLink className="h-4 w-4" />
    </a>
  );
}
