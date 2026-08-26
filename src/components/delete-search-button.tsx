"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteSearchButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/saved-searches", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        setError("Could not remove saved search.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not remove saved search.");
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
        className="rounded-full border border-card-border px-3 py-1.5 text-xs font-medium text-forest-muted hover:text-red-600 disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? "Removing…" : "Remove"}
      </button>
      {error ? <span role="alert" className="text-xs text-red-600">{error}</span> : null}
    </span>
  );
}
