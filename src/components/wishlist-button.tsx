"use client";

import { Heart } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function WishlistButton({
  productId,
  initial = false,
}: {
  productId: string;
  initial?: boolean;
}) {
  const pathname = usePathname();
  const [liked, setLiked] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
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
        setLiked(!next);
        window.location.href = `/login?next=${encodeURIComponent(pathname || "/")}`;
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
      aria-pressed={liked}
      className={cn(
        "dn-button-secondary min-h-12 px-5",
        liked ? "border-red-200 text-red-600 dark:border-red-900/70 dark:text-red-300" : "text-forest-ink",
      )}
    >
      <Heart className={cn("h-4 w-4", liked && "fill-current")} aria-hidden="true" />
      {busy ? "Updating…" : liked ? "Saved" : "Save to wishlist"}
    </button>
  );
}
