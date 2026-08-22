"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

export function DeleteSearchButton({ id }: { id: string }) {
  const router = useRouter();
  const [removing, setRemoving] = useState(false);

  async function remove() {
    if (removing) return;
    setRemoving(true);
    try {
      const res = await fetch("/api/saved-searches", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) router.refresh();
    } finally {
      setRemoving(false);
    }
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={removing}
      className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-card-border px-3.5 text-xs font-bold text-forest-muted transition hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-red-950/30"
    >
      <Trash2 className="h-3.5 w-3.5" /> {removing ? "Removing…" : "Remove"}
    </button>
  );
}
