"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    router.push("/");
    router.refresh();
  }
  return (
    <button
      type="button"
      onClick={logout}
      className="rounded-full border border-card-border px-4 py-2 text-sm font-medium text-forest-ink hover:border-forest/40"
    >
      Sign out
    </button>
  );
}
