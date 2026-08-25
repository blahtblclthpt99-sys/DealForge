"use client";

import { Heart } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function WishlistButton({
  productId,
  initial = false,
}: {
  productId: string;
  initial?: boolean;
}) {
  const [liked, setLiked] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const previous = liked;
    const next = !previous;
    setLiked(next);

    try {
      const res = await fetch("/api/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, action: next ? "add" : "remove" }),
      });
      if (res.status === 401) {
        setLiked(previous);
        const current = `${window.location.pathname}${window.location.search}`;
        window.location.href = `/login?next=${encodeURIComponent(current)}`;
        return;
      }
      if (!res.ok) setLiked(previous);
    } catch {
      setLiked(previous);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={toggle}
      aria-pressed={liked}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-card-border bg-card px-5 py-3 text-sm font-semibold transition hover:border-forest/40 disabled:cursor-wait disabled:opacity-60",
        liked ? "text-red-500" : "text-forest-ink",
      )}
    >
      <Heart className={cn("h-4 w-4", liked && "fill-current")} />
      {liked ? "Saved" : "Save to wishlist"}
    </button>
  );
}
