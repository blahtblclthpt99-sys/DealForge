"use client";

import { useState } from "react";
import { ClipboardPaste, Plus, RefreshCw, ShieldCheck } from "lucide-react";

export function OwnerProductIntake() {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<"add" | "refresh" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(body: Record<string, unknown>, mode: "add" | "refresh") {
    setBusy(mode);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/admin/product-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        status?: string;
        queue?: { status?: string; queued?: number; updated?: number };
        maintenance?: { priceUpdates?: number; priceRefreshStatus?: string };
      };
      if (!response.ok) {
        setError(data.error || "Product action failed");
        return;
      }

      if (mode === "add") {
        setMessage(data.message || `ASIN ${data.status || "accepted"}.`);
        setValue("");
      } else {
        const queueUpdated = data.queue?.updated ?? 0;
        const priceUpdates = data.maintenance?.priceUpdates ?? 0;
        const status = data.maintenance?.priceRefreshStatus || data.queue?.status || "complete";
        setMessage(`Refresh complete: ${queueUpdated} queued item(s) enriched, ${priceUpdates} price update(s). ${status}.`);
      }
    } catch {
      setError("Could not reach the owner product service. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function pasteAndAdd() {
    setMessage(null);
    setError(null);
    if (!navigator.clipboard?.readText) {
      setError("Clipboard access is not available here. Paste the ASIN into the field instead.");
      return;
    }

    try {
      const clipboardValue = (await navigator.clipboard.readText()).trim().slice(0, 500);
      if (!clipboardValue) {
        setError("Your clipboard is empty. Copy an Amazon ASIN or product link first.");
        return;
      }
      setValue(clipboardValue);
      await run({ action: "add", value: clipboardValue }, "add");
    } catch {
      setError("Clipboard permission was blocked. Paste the ASIN into the field instead.");
    }
  }

  return (
    <section className="dn-card mt-8 overflow-hidden border-[#F97316]/25 p-5 sm:p-6" aria-labelledby="owner-product-tools">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-[#F97316]/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-[#F97316]">
            <ShieldCheck className="h-3.5 w-3.5" /> Owner only
          </div>
          <h2 id="owner-product-tools" className="mt-3 font-display text-2xl font-semibold text-forest-ink">
            Quick product intake
          </h2>
          <p className="mt-2 text-sm leading-6 text-forest-muted">
            Copy an Amazon ASIN or product link and tap Paste &amp; Add, or enter it below. If approved retailer data is available, DealForge enriches it immediately. Otherwise it stays in your private queue and never appears on the storefront as an unfinished listing.
          </p>
        </div>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => run({ action: "refresh" }, "refresh")}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-card-border bg-background px-4 py-2.5 text-sm font-bold text-forest transition hover:border-[#F97316]/40 hover:bg-[#F97316]/5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${busy === "refresh" ? "animate-spin" : ""}`} />
          Refresh catalog now
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void pasteAndAdd()}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#F97316] px-5 py-3 text-sm font-extrabold text-white shadow-[0_8px_22px_rgba(249,115,22,.18)] transition hover:bg-[#EA580C] disabled:cursor-not-allowed disabled:opacity-50 sm:order-2"
        >
          <ClipboardPaste className="h-4 w-4" />
          {busy === "add" ? "Adding…" : "Paste & Add"}
        </button>

        <form
          className="flex min-w-0 flex-col gap-3 sm:flex-row sm:order-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (!value.trim() || busy) return;
            void run({ action: "add", value }, "add");
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="sr-only">Amazon ASIN or Amazon product URL</span>
            <input
              value={value}
              onChange={(event) => setValue(event.target.value.slice(0, 500))}
              autoCapitalize="characters"
              autoComplete="off"
              inputMode="text"
              placeholder="Paste ASIN or Amazon product URL"
              className="min-h-12 w-full rounded-xl border border-card-border bg-background px-4 py-3 text-sm text-forest-ink outline-none focus:border-[#F97316]/60 focus:ring-2 focus:ring-[#F97316]/15"
            />
          </label>
          <button
            type="submit"
            disabled={!value.trim() || busy !== null}
            className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl border border-[#F97316]/30 bg-[#F97316]/10 px-5 py-3 text-sm font-bold text-[#EA580C] transition hover:bg-[#F97316]/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Add typed ASIN
          </button>
        </form>
      </div>

      {message ? (
        <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/20 dark:text-emerald-300">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/20 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <p className="mt-4 text-xs leading-5 text-forest-muted">
        This tool does not scrape Amazon pages or fabricate prices. Public cards may show a clearly labeled recorded catalog price, while verified-current pricing is only promoted when an approved retailer source has refreshed it.
      </p>
    </section>
  );
}
