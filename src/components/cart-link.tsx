"use client";

import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { useSyncExternalStore } from "react";
import { CART_CHANGED_EVENT, cartCount, readCart } from "@/lib/cart-client";

function subscribeToCart(onStoreChange: () => void) {
  window.addEventListener(CART_CHANGED_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(CART_CHANGED_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function getCartCountSnapshot() {
  return cartCount(readCart());
}

function getServerCartCountSnapshot() {
  return 0;
}

export function CartLink({ compact = false }: { compact?: boolean }) {
  const count = useSyncExternalStore(
    subscribeToCart,
    getCartCountSnapshot,
    getServerCartCountSnapshot,
  );

  return (
    <Link
      href="/cart"
      aria-label={`Cart${count ? `, ${count} item${count === 1 ? "" : "s"}` : ""}`}
      className={compact
        ? "relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-card-border text-forest transition hover:bg-forest/5"
        : "relative inline-flex items-center gap-2 rounded-full border border-card-border px-3 py-2 text-sm font-medium text-forest transition hover:bg-forest/5"}
    >
      <ShoppingCart className="h-4 w-4" />
      {!compact ? <span>Cart</span> : null}
      {count > 0 ? (
        <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-forest px-1 text-[10px] font-bold leading-none text-white">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
