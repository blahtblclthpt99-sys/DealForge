"use client";

import { ShoppingCart } from "lucide-react";
import { useState } from "react";
import { addCartItem } from "@/lib/cart-client";

export function QuickAddButton({ productId }: { productId: string }) {
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);

  async function add() {
    if (busy) return;
    setBusy(true);
    setAdded(false);
    try {
      const response = await fetch("/api/cart/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(payload.items)) return;
      addCartItem(productId, 1);
      setAdded(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={add}
      disabled={busy}
      aria-label={added ? "Added to cart" : "Add to cart"}
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-forest px-3 py-2 text-xs font-semibold text-white hover:bg-forest-dark disabled:opacity-60"
    >
      <ShoppingCart className="h-3.5 w-3.5" /> {busy ? "Pricing…" : added ? "Added" : "Add"}
    </button>
  );
}
