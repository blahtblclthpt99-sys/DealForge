"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
      if (!res.ok) {
        setError("Could not sign out. Try again.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Could not sign out. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <button type="button" onClick={logout} disabled={busy} className="dn-button-secondary min-h-12">
        <LogOut className="h-4 w-4" aria-hidden="true" /> {busy ? "Signing out…" : "Sign out"}
      </button>
      {error ? <p className="max-w-52 text-xs leading-5 text-red-600 dark:text-red-300" role="alert">{error}</p> : null}
    </div>
  );
}
