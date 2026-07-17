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
    setBusy(true);
    const next = !liked;
    setLiked(next);
    try {
      const res = await fetch("/api/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, action: next ? "add" : "remove" }),
      });
      if (res.status === 401) {
        window.location.href = `/login?next=/product/`;
        return;
      }
      if (!res.ok) setLiked(!next);
    } catch {
      setLiked(!next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={toggle}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-card-border bg-card px-5 py-3 text-sm font-semibold transition hover:border-forest/40",
        liked ? "text-red-500" : "text-forest-ink",
      )}
    >
      <Heart className={cn("h-4 w-4", liked && "fill-current")} />
      {liked ? "Saved" : "Save to wishlist"}
    </button>
  );
}
