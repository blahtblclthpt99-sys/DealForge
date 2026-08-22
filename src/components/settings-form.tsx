"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Save, Trash2 } from "lucide-react";

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
  const [saveOk, setSaveOk] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteMsg, setDeleteMsg] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;

    setSaving(true);
    setSaveMsg("");
    setSaveOk(null);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: displayName,
          settings: { emailAlerts },
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setSaveOk(res.ok);
      setSaveMsg(res.ok ? "Settings saved." : body?.error || "Could not save settings.");
      if (res.ok) router.refresh();
    } catch {
      setSaveOk(false);
      setSaveMsg("Could not save settings. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteAccount(e: FormEvent) {
    e.preventDefault();
    if (deleting) return;
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
      <form onSubmit={onSubmit} className="dn-card overflow-hidden" aria-busy={saving}>
        <div className="border-b border-card-border p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-forest/9 text-forest">
              <Save className="h-4 w-4" />
            </span>
            <div>
              <h2 className="font-display text-xl font-semibold text-forest-ink">Profile and preferences</h2>
              <p className="mt-1 text-sm leading-6 text-forest-muted">Update the account details and notification preferences DealForge currently supports.</p>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-5 sm:p-6">
          <div>
            <label htmlFor="settings-display-name" className="mb-2 block text-sm font-bold text-forest-ink">Display name</label>
            <input
              id="settings-display-name"
              required
              minLength={2}
              maxLength={80}
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="dn-input"
            />
          </div>

          <div>
            <label htmlFor="settings-email" className="mb-2 block text-sm font-bold text-forest-ink">Email address</label>
            <input
              id="settings-email"
              value={email}
              disabled
              autoComplete="email"
              className="dn-input cursor-not-allowed bg-forest-bg/50 opacity-70"
            />
            <p className="mt-2 text-xs leading-5 text-forest-muted">Email changes are not available from this screen.</p>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-card-border bg-background/55 p-4 text-sm text-forest-ink transition hover:border-forest/25">
            <input
              type="checkbox"
              checked={emailAlerts}
              onChange={(e) => setEmailAlerts(e.target.checked)}
              className="mt-1 h-4 w-4 accent-[#F97316]"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-2 font-bold"><BellRing className="h-4 w-4 text-forest" /> Email price-alert delivery when available</span>
              <span className="mt-1 block text-xs font-normal leading-5 text-forest-muted">
                DealForge currently evaluates alerts in-app. Email delivery is not active yet.
              </span>
            </span>
          </label>

          {saveMsg ? (
            <p className={saveOk ? "dn-status-success" : "dn-status-error"} role="status" aria-live="polite">
              {saveMsg}
            </p>
          ) : null}

          <button type="submit" disabled={saving} className="dn-button-primary">
            <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>

      <form onSubmit={deleteAccount} className="overflow-hidden rounded-[1.25rem] border border-red-200/80 bg-card dark:border-red-900/60" aria-busy={deleting}>
        <div className="border-b border-red-200/70 bg-red-50/65 p-5 dark:border-red-900/50 dark:bg-red-950/18 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300">
              <Trash2 className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-red-700 dark:text-red-300">Danger zone</p>
              <h2 className="mt-1 font-display text-xl font-semibold text-forest-ink">Delete account</h2>
              <p className="mt-2 text-sm leading-6 text-forest-muted">
                Permanently delete your DealForge account, saved searches, wishlist, preferences, and price alerts. Aggregate product click totals remain anonymous.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-5 sm:p-6">
          <div>
            <label htmlFor="delete-password" className="mb-2 block text-sm font-bold text-forest-ink">Current password</label>
            <input
              id="delete-password"
              required
              minLength={8}
              maxLength={128}
              type="password"
              autoComplete="current-password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              className="dn-input"
            />
          </div>

          <div>
            <label htmlFor="delete-confirmation" className="mb-2 block text-sm font-bold text-forest-ink">
              Type <strong>DELETE</strong> to confirm
            </label>
            <input
              id="delete-confirmation"
              required
              autoComplete="off"
              value={deleteConfirmation}
              onChange={(e) => setDeleteConfirmation(e.target.value)}
              className="dn-input"
            />
          </div>

          {deleteMsg ? <p className="dn-status-error" role="status" aria-live="polite">{deleteMsg}</p> : null}

          <button
            type="submit"
            disabled={deleting || deletePassword.length < 8 || deleteConfirmation !== "DELETE"}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-red-300 px-5 py-3 text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30"
          >
            <Trash2 className="h-4 w-4" /> {deleting ? "Deleting account…" : "Permanently delete account"}
          </button>
        </div>
      </form>
    </div>
  );
}
