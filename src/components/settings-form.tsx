"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function SettingsForm({
  name,
  email,
  settings,
}: {
  name: string;
  email: string;
  settings: Record<string, unknown>;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(name);
  const [emailAlerts, setEmailAlerts] = useState(Boolean(settings.emailAlerts ?? true));
  const [msg, setMsg] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: displayName,
        settings: { ...settings, emailAlerts },
      }),
    });
    setMsg(res.ok ? "Saved" : "Could not save");
    if (res.ok) router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="dn-card space-y-4 p-6">
      <label className="block text-sm">
        <span className="mb-1 block text-forest-muted">Display name</span>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full rounded-xl border border-card-border bg-background px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-forest-muted">Email</span>
        <input value={email} disabled className="w-full rounded-xl border border-card-border bg-forest-bg/50 px-3 py-2 opacity-70" />
      </label>
      <label className="flex items-center gap-2 text-sm text-forest-ink">
        <input
          type="checkbox"
          checked={emailAlerts}
          onChange={(e) => setEmailAlerts(e.target.checked)}
        />
        Email me about price-drop alerts
      </label>
      {msg && <p className="text-sm text-forest-muted">{msg}</p>}
      <button type="submit" className="rounded-full bg-forest px-5 py-2.5 text-sm font-semibold text-white">
        Save settings
      </button>
    </form>
  );
}
