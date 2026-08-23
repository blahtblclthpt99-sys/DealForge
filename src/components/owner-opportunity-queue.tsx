"use client";

import { useEffect, useState } from "react";
import { Clipboard, ExternalLink, RefreshCw, ShieldCheck, TrendingUp } from "lucide-react";

type Opportunity = {
  id: string;
  slug: string;
  title: string;
  brand: string;
  retailer: string;
  asin: string | null;
  sourceUrl: string;
  readyForOwnerActivation: boolean;
  readinessReason: string;
  profitabilityTier: "strong" | "healthy" | "thin" | "blocked";
  profitabilityScore: number | null;
  estimatedProfitCents: number | null;
  grossMarginBps: number | null;
  landedCostCents: number | null;
  sellingPriceCents: number | null;
  sourceAgeMs: number | null;
  sourceFreshnessRemainingMs: number | null;
  clickCount: number;
  viewCount: number;
};

type Payload = {
  ok: true;
  advisoryOnly: true;
  automaticActivationEnabled: false;
  financialGateCertified: boolean;
  scanned: number;
  readyCount: number;
  blockedCount: number;
  demandSignalsAffectRanking: false;
  items: Opportunity[];
};

function money(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function percent(bps: number | null) {
  return bps == null ? "—" : `${(bps / 100).toFixed(1)}%`;
}

function freshness(ms: number | null) {
  if (ms == null) return "unknown";
  const hours = Math.max(0, Math.floor(ms / (60 * 60 * 1000)));
  return hours < 48 ? `${hours}h remaining` : `${Math.floor(hours / 24)}d remaining`;
}

async function fetchQueue(): Promise<Payload> {
  const response = await fetch("/api/admin/commerce/opportunities", { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) throw new Error("OPPORTUNITY_QUEUE_UNAVAILABLE");
  return data as Payload;
}

export function OwnerOpportunityQueue() {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchQueue()
      .then((next) => {
        if (active) setData(next);
      })
      .catch(() => {
        if (active) setError("Could not load reviewed commerce opportunities.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      setData(await fetchQueue());
    } catch {
      setError("Could not load reviewed commerce opportunities.");
    } finally {
      setBusy(false);
    }
  }

  async function copyProductId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((current) => current === id ? null : current), 1500);
    } catch {
      setCopiedId(null);
    }
  }

  return (
    <section className="dn-card mt-8 p-5 sm:p-6" aria-labelledby="owner-opportunity-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-violet-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-violet-800 dark:bg-violet-950/30 dark:text-violet-300">
            <TrendingUp className="h-3.5 w-3.5" /> Profit opportunities
          </div>
          <h2 id="owner-opportunity-title" className="mt-3 font-display text-2xl font-semibold text-forest-ink">Reviewed opportunity priority</h2>
          <p className="mt-2 text-sm leading-6 text-forest-muted">
            Advisory only. Ready products are ranked by saved profitability tier, score, estimated contribution, margin, then source freshness. Clicks and views are context only and never override financial readiness.
          </p>
        </div>
        <button disabled={busy} onClick={() => void refresh()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-card-border px-4 text-sm font-bold text-forest disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {data ? (
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">{data.readyCount} ready for owner review</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700 dark:bg-slate-900 dark:text-slate-300">{data.blockedCount} blocked/stale</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700 dark:bg-slate-900 dark:text-slate-300">{data.scanned} reviewed candidates scanned</span>
        </div>
      ) : null}

      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
        <ShieldCheck className="mr-1 inline h-4 w-4" /> This queue cannot activate products. Use the Commerce Control Center and its explicit attestations for any activation decision.
      </div>

      {error ? <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      {!busy && !error && data?.items.length === 0 ? <p className="mt-5 text-sm text-forest-muted">No saved owner-reviewed recommendations are available yet.</p> : null}

      <div className="mt-5 space-y-3">
        {data?.items.slice(0, 25).map((item, index) => (
          <article key={item.id} className="rounded-2xl border border-card-border bg-background p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-wide text-forest-muted">#{index + 1} · {item.profitabilityTier} · score {item.profitabilityScore ?? "—"}</p>
                <h3 className="mt-1 truncate text-base font-bold text-forest-ink">{item.title}</h3>
                <p className="mt-1 text-xs text-forest-muted">{item.brand || "Unbranded"} · {item.retailer} · {item.asin || item.id}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${item.readyForOwnerActivation ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"}`}>
                {item.readyForOwnerActivation ? "Ready for owner activation review" : item.readinessReason.replaceAll("_", " ").toLowerCase()}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div><span className="text-forest-muted">Est. contribution</span><p className="font-bold text-forest-ink">{money(item.estimatedProfitCents)}</p></div>
              <div><span className="text-forest-muted">Gross margin</span><p className="font-bold text-forest-ink">{percent(item.grossMarginBps)}</p></div>
              <div><span className="text-forest-muted">Selling price</span><p className="font-bold text-forest-ink">{money(item.sellingPriceCents)}</p></div>
              <div><span className="text-forest-muted">Source freshness</span><p className="font-bold text-forest-ink">{freshness(item.sourceFreshnessRemainingMs)}</p></div>
            </div>
            <p className="mt-2 text-xs text-forest-muted">Demand context: {item.clickCount} clicks · {item.viewCount} views</p>

            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => void copyProductId(item.id)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-card-border px-3 text-xs font-bold text-forest">
                <Clipboard className="h-3.5 w-3.5" /> {copiedId === item.id ? "Copied" : "Copy product ID"}
              </button>
              <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-card-border px-3 text-xs font-bold text-forest">
                <ExternalLink className="h-3.5 w-3.5" /> Verify supplier source
              </a>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
