"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function PriceAlertForm() {
  const router = useRouter();
  const [productId, setProductId] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [msg, setMsg] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/price-alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, targetPrice: Number(targetPrice) }),
    });
    if (!res.ok) {
      setMsg("Could not create alert");
      return;
    }
    setMsg("Alert saved");
    setProductId("");
    setTargetPrice("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="dn-card grid gap-3 p-4 md:grid-cols-[1fr_140px_auto]">
      <input
        required
        value={productId}
        onChange={(e) => setProductId(e.target.value)}
        placeholder="Product ID (from product page URL slug lookup in admin, or DB id)"
        className="rounded-xl border border-card-border bg-background px-3 py-2 text-sm"
      />
      <input
        required
        type="number"
        step="0.01"
        value={targetPrice}
        onChange={(e) => setTargetPrice(e.target.value)}
        placeholder="Target $"
        className="rounded-xl border border-card-border bg-background px-3 py-2 text-sm"
      />
      <button type="submit" className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-white">
        Add alert
      </button>
      {msg && <p className="text-xs text-forest-muted md:col-span-3">{msg}</p>}
    </form>
  );
}

export function DeleteAlertButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/price-alerts", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        router.refresh();
      }}
      className="rounded-full border border-card-border px-3 py-1.5 text-xs text-forest-muted hover:text-red-600"
    >
      Remove
    </button>
  );
}
