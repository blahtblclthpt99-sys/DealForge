"use client";

import Link from "next/link";
import { ExternalLink, ShoppingCart } from "lucide-react";
import { useState } from "react";
import { addCartItem } from "@/lib/cart-client";

export function BuyButton({
  productId,
  purchaseMode = "affiliate",
  affiliateLabel = "View listing",
}: {
  productId: string;
  purchaseMode?: "direct" | "affiliate";
  customerEmail?: string;
  affiliateLabel?: string;
  retailer?: string;
  /** @deprecated Links are built live via /go/[productId] */
  affiliateUrl?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState("");

  if (purchaseMode !== "direct") {
    return (
      <a
        href={`/go/${productId}`}
        target="_blank"
        rel="noopener noreferrer sponsored nofollow"
        className="inline-flex items-center gap-2 rounded-full bg-forest px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-forest-dark"
      >
        {affiliateLabel} <ExternalLink className="h-4 w-4" />
      </a>
    );
  }

  async function addToCart() {
    setBusy(true);
    setAdded(false);
    setError("");
    try {
      // The server makes the authoritative customer-friendly price decision at
      // cart-add time. Only product identity and quantity are stored locally;
      // client-provided prices are never trusted by checkout.
      const response = await fetch("/api/cart/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(payload.items)) {
        const reason = typeof payload.error === "string" ? payload.error : "CART_QUOTE_UNAVAILABLE";
        throw new Error(reason);
      }
      addCartItem(productId, 1);
      setAdded(true);
    } catch (cartError) {
      const message = cartError instanceof Error ? cartError.message : "CART_QUOTE_UNAVAILABLE";
      setError(
        message === "PRODUCT_COMMERCE_GATE_FAILED" ||
        message === "PRODUCT_SUPPLIER_BINDING_FAILED" ||
        message === "PUBLISHED_PRICE_NO_LONGER_SAFE" ||
        message === "MINIMUM_SAFE_PROFIT_NOT_MET" ||
        message === "COMMERCE_DISABLED"
          ? "This item is temporarily unavailable at a safe DealForge price."
          : "We could not confirm this item's cart price. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-[16rem] max-w-sm">
      <button
        type="button"
        disabled={busy}
        onClick={addToCart}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-forest px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-forest-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        <ShoppingCart className="h-4 w-4" /> {busy ? "Confirming cart price…" : added ? "Added to cart" : "Add to cart"}
      </button>
      {added ? (
        <div className="mt-2 flex items-center justify-between gap-3 text-xs">
          <span className="font-medium text-forest">Price confirmed in your cart.</span>
          <Link href="/cart" className="font-semibold text-forest hover:underline">View cart</Link>
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
