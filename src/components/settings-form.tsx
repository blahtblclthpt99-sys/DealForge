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
  const [saveMsg, setSaveMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteMsg, setDeleteMsg] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: displayName,
          // Send only settings owned by this UI. Do not echo unknown legacy
          // properties into the strict account API schema.
          settings: { emailAlerts },
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setSaveMsg(res.ok ? "Settings saved." : body?.error || "Could not save settings.");
      if (res.ok) router.refresh();
    } catch {
      setSaveMsg("Could not save settings. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteAccount(e: FormEvent) {
    e.preventDefault();
    if (deleteConfirmation !== "DELETE") {
      setDeleteMsg("Type DELETE exactly to confirm account deletion.");
      return;
    }

    setDeleting(true);
    setDeleteMsg("");
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: deletePassword,
          confirmation: deleteConfirmation,
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setDeleteMsg(body?.error || "Could not delete the account.");
        return;
      }

      router.replace("/");
      router.refresh();
    } catch {
      setDeleteMsg("Could not delete the account. Check your connection and try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} className="dn-card space-y-4 p-6">
        <label className="block text-sm">
          <span className="mb-1 block text-forest-muted">Display name</span>
          <input
            required
            minLength={2}
            maxLength={80}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-xl border border-card-border bg-background px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-forest-muted">Email</span>
          <input
            value={email}
            disabled
            className="w-full rounded-xl border border-card-border bg-forest-bg/50 px-3 py-2 opacity-70"
          />
        </label>
        <label className="flex items-start gap-2 text-sm text-forest-ink">
          <input
            type="checkbox"
            checked={emailAlerts}
            onChange={(e) => setEmailAlerts(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Enable email price-alert delivery when available
            <span className="mt-0.5 block text-xs font-normal text-forest-muted">
              DealForge currently evaluates alerts in-app. Email delivery is not active yet.
            </span>
          </span>
        </label>
        <p className="min-h-5 text-sm text-forest-muted" role="status" aria-live="polite">
          {saveMsg}
        </p>
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-forest px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
      </form>

      <form onSubmit={deleteAccount} className="rounded-2xl border border-red-200 bg-card p-6">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-red-600">Danger zone</p>
        <h2 className="mt-1 font-display text-xl font-semibold text-forest-ink">Delete account</h2>
        <p className="mt-2 text-sm leading-relaxed text-forest-muted">
          Permanently delete your DealForge account, saved searches, wishlist, preferences, and price alerts. Aggregate product click totals remain anonymous.
        </p>

        <div className="mt-4 grid gap-3">
          <label className="block text-sm">
            <span className="mb-1 block text-forest-muted">Current password</span>
            <input
              required
              minLength={8}
              maxLength={128}
              type="password"
              autoComplete="current-password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              className="w-full rounded-xl border border-card-border bg-background px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-forest-muted">
              Type <strong className="text-forest-ink">DELETE</strong> to confirm
            </span>
            <input
              required
              autoComplete="off"
              value={deleteConfirmation}
              onChange={(e) => setDeleteConfirmation(e.target.value)}
              className="w-full rounded-xl border border-card-border bg-background px-3 py-2"
            />
          </label>
        </div>

        <p className="mt-3 min-h-5 text-sm text-red-600" role="status" aria-live="polite">
          {deleteMsg}
        </p>
        <button
          type="submit"
          disabled={
            deleting || deletePassword.length < 8 || deleteConfirmation !== "DELETE"
          }
          className="mt-2 rounded-full border border-red-300 px-5 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {deleting ? "Deleting account…" : "Permanently delete account"}
        </button>
      </form>
    </div>
  );
}
