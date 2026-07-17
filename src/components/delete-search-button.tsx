"use client";

import { useRouter } from "next/navigation";

export function DeleteSearchButton({ id }: { id: string }) {
  const router = useRouter();
  async function remove() {
    await fetch("/api/saved-searches", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    router.refresh();
  }
  return (
    <button
      type="button"
      onClick={remove}
      className="rounded-full border border-card-border px-3 py-1.5 text-xs font-medium text-forest-muted hover:text-red-600"
    >
      Remove
    </button>
  );
}
