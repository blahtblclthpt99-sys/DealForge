"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function PriceAlertForm() {
  const router = useRouter();
  const [productId, setProductId] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;

    const parsedTargetPrice = Number(targetPrice);
    if (!Number.isFinite(parsedTargetPrice) || parsedTargetPrice <= 0 || parsedTargetPrice > 1_000_000) {
      setMsg("Enter a valid target price.");
      return;
    }

    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/price-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: productId.trim(), targetPrice: parsedTargetPrice }),
      });
      if (!res.ok) {
        setMsg(res.status === 404 ? "Product not found." : "Could not create alert. Please try again.");
        return;
      }
      setMsg("Alert saved");
      setProductId("");
      setTargetPrice("");
      router.refresh();
    } catch {
      setMsg("Could not create alert. Please try again.");
    } finally {
      setSaving(false);
    }
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
        min="0.01"
        max="1000000"
        step="0.01"
        value={targetPrice}
        onChange={(e) => setTargetPrice(e.target.value)}
        placeholder="Target $"
        className="rounded-xl border border-card-border bg-background px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={saving}
        className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60"
      >
        {saving ? "Adding…" : "Add alert"}
      </button>
      {msg && <p role="status" className="text-xs text-forest-muted md:col-span-3">{msg}</p>}
    </form>
  );
}

export function DeleteAlertButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/price-alerts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        setError("Could not remove alert.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not remove alert.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className="rounded-full border border-card-border px-3 py-1.5 text-xs text-forest-muted hover:text-red-600 disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? "Removing…" : "Remove"}
      </button>
      {error ? <span role="alert" className="text-xs text-red-600">{error}</span> : null}
    </span>
  );
}
