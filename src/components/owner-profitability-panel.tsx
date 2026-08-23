"use client";

import { useEffect, useState } from "react";
import { Calculator, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";

type ProfitabilityOrder = {
  orderId: string;
  orderNumber: string;
  financialStatus: string;
  fulfillmentState: string | null;
  createdAt: string;
  paidAt: string | null;
  eligibleForRollup: boolean;
  status: string;
  currency: string;
  grossCustomerRevenueCents: number;
  refundedCents: number;
  netCustomerRevenueCents: number;
  estimatedSupplierCostCents: number | null;
  actualSupplierCostCents: number | null;
  supplierCostVarianceCents: number | null;
  contributionCents: number | null;
  contributionMarginBps: number | null;
  excludesPaymentFeesAndOverhead: true;
};

type ProfitabilitySummary = {
  orderCount: number;
  realizedOrderCount: number;
  awaitingCostCount: number;
  excludedCount: number;
  negativeContributionCount: number;
  grossCustomerRevenueCents: number;
  refundedCents: number;
  netCustomerRevenueCents: number;
  actualSupplierCostCents: number;
  contributionCents: number;
  contributionMarginBps: number | null;
  excludesPaymentFeesAndOverhead: true;
};

type Payload = {
  ok: true;
  periodDays: number;
  limitedToMostRecentOrders: number;
  accountingBasis: string;
  summary: ProfitabilitySummary;
  orders: ProfitabilityOrder[];
};

const PERIODS = [30, 90, 365] as const;

function money(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function percent(bps: number | null) {
  if (bps == null) return "—";
  return `${(bps / 100).toFixed(1)}%`;
}

async function fetchProfitability(days: number): Promise<Payload> {
  const response = await fetch(`/api/admin/commerce/profitability?days=${days}`, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) throw new Error(typeof data?.error === "string" ? data.error : "PROFITABILITY_LOAD_FAILED");
  return data as Payload;
}

export function OwnerProfitabilityPanel() {
  const [days, setDays] = useState<number>(90);
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchProfitability(90)
      .then((next) => {
        if (active) setData(next);
      })
      .catch(() => {
        if (active) setError("Could not load contribution analytics.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function load(nextDays = days) {
    setBusy(true);
    setError(null);
    try {
      const next = await fetchProfitability(nextDays);
      setData(next);
      setDays(nextDays);
    } catch {
      setError("Could not load contribution analytics.");
    } finally {
      setBusy(false);
    }
  }

  const summary = data?.summary;
  const realizedOrders = data?.orders.filter((order) => order.eligibleForRollup) || [];

  return (
    <section className="dn-card mt-8 p-5 sm:p-6" aria-labelledby="owner-profitability-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-sky-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-sky-800 dark:bg-sky-950/30 dark:text-sky-300">
            <Calculator className="h-3.5 w-3.5" /> Owner finance
          </div>
          <h2 id="owner-profitability-title" className="mt-3 font-display text-2xl font-semibold text-forest-ink">Realized contribution</h2>
          <p className="mt-2 text-sm leading-6 text-forest-muted">
            Customer revenue minus succeeded refunds and recorded actual supplier cost. This is <strong>not net profit</strong>: Stripe/payment processing fees, taxes owed by DealForge, labor, support, chargebacks, and overhead are not deducted here.
          </p>
        </div>
        <button disabled={busy} onClick={() => void load()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-card-border px-4 text-sm font-bold text-forest disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" aria-label="Contribution period">
        {PERIODS.map((period) => (
          <button
            key={period}
            type="button"
            disabled={busy}
            onClick={() => void load(period)}
            className={`min-h-10 rounded-full px-4 text-sm font-semibold ${days === period ? "bg-forest text-white" : "border border-card-border text-forest"}`}
          >
            {period} days
          </button>
        ))}
      </div>

      {error ? <p role="alert" className="mt-4 text-sm font-medium text-red-700 dark:text-red-300">{error}</p> : null}

      {summary ? (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-2xl border border-card-border p-4">
              <p className="text-xs uppercase tracking-wide text-forest-muted">Realized contribution</p>
              <p className={`mt-1 text-2xl font-bold ${summary.contributionCents < 0 ? "text-red-700 dark:text-red-300" : "text-forest"}`}>{money(summary.contributionCents)}</p>
              <p className="mt-1 text-xs text-forest-muted">{percent(summary.contributionMarginBps)} of realized net revenue</p>
            </div>
            <div className="rounded-2xl border border-card-border p-4">
              <p className="text-xs uppercase tracking-wide text-forest-muted">Net customer revenue</p>
              <p className="mt-1 text-2xl font-bold text-forest">{money(summary.netCustomerRevenueCents)}</p>
              <p className="mt-1 text-xs text-forest-muted">After {money(summary.refundedCents)} succeeded refunds</p>
            </div>
            <div className="rounded-2xl border border-card-border p-4">
              <p className="text-xs uppercase tracking-wide text-forest-muted">Actual supplier cost</p>
              <p className="mt-1 text-2xl font-bold text-forest">{money(summary.actualSupplierCostCents)}</p>
              <p className="mt-1 text-xs text-forest-muted">Recorded manual purchases only</p>
            </div>
            <div className="rounded-2xl border border-card-border p-4">
              <p className="text-xs uppercase tracking-wide text-forest-muted">Coverage</p>
              <p className="mt-1 text-2xl font-bold text-forest">{summary.realizedOrderCount}/{summary.orderCount}</p>
              <p className="mt-1 text-xs text-forest-muted">{summary.awaitingCostCount} awaiting actual cost · {summary.negativeContributionCount} negative</p>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-2xl border border-card-border">
            <div className="border-b border-card-border bg-background/60 px-4 py-3">
              <h3 className="text-sm font-bold text-forest-ink">Recent realized orders</h3>
              <p className="mt-1 text-xs text-forest-muted">Only ledger-certified orders with an actual supplier cost are included in the monetary rollup.</p>
            </div>
            {realizedOrders.length === 0 ? (
              <p className="p-5 text-sm text-forest-muted">No orders in this period have enough verified data for realized contribution yet.</p>
            ) : (
              <div className="divide-y divide-card-border">
                {realizedOrders.slice(0, 25).map((order) => {
                  const negative = (order.contributionCents || 0) < 0;
                  return (
                    <div key={order.orderId} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                      <div>
                        <p className="text-sm font-bold text-forest-ink">{order.orderNumber}</p>
                        <p className="mt-1 text-xs text-forest-muted">
                          Revenue {money(order.netCustomerRevenueCents)} · supplier {money(order.actualSupplierCostCents)} · variance {money(order.supplierCostVarianceCents)}
                        </p>
                      </div>
                      <div className={`flex items-center gap-2 text-sm font-bold ${negative ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}>
                        {negative ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
                        {money(order.contributionCents)} · {percent(order.contributionMarginBps)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : busy ? <p className="mt-5 text-sm text-forest-muted">Loading contribution analytics…</p> : null}
    </section>
  );
}
