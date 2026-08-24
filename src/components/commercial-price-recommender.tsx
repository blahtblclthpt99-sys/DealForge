"use client";

import { useState } from "react";

type Recommendation = {
  recommendedPriceCents: number;
  minimumSafePriceCents: number;
  landedCostCents: number;
  reserveTotalCents: number;
  contributionProfitCents: number;
  contributionMarginBps: number;
  marketCompatible: boolean;
  marketCeilingCents: number | null;
  reasons: string[];
};

function dollarsToCents(value: string, field: string, allowZero = false) {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) throw new Error(`${field} must be a valid dollar amount`);
  const cents = Math.round(Number(trimmed) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0 || (!allowZero && cents === 0)) throw new Error(`${field} is invalid`);
  return cents;
}

function money(cents: number | null) {
  return cents === null ? "—" : `$${(cents / 100).toFixed(2)}`;
}

export function CommercialPriceRecommender() {
  const [itemCost, setItemCost] = useState("");
  const [shipping, setShipping] = useState("0");
  const [tax, setTax] = useState("0");
  const [supplierFee, setSupplierFee] = useState("0");
  const [handling, setHandling] = useState("0");
  const [acquisitionReserve, setAcquisitionReserve] = useState("0");
  const [marketReference, setMarketReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Recommendation | null>(null);

  async function calculate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const body = {
        itemCostCents: dollarsToCents(itemCost, "Item cost"),
        shippingCents: dollarsToCents(shipping, "Shipping", true),
        taxCents: dollarsToCents(tax, "Tax", true),
        supplierFeeCents: dollarsToCents(supplierFee, "Supplier fee", true),
        handlingCents: dollarsToCents(handling, "Handling", true),
        acquisitionReserveCents: dollarsToCents(acquisitionReserve, "Acquisition reserve", true),
        marketReferenceCents: marketReference.trim() ? dollarsToCents(marketReference, "Market reference") : null,
        maxMarketPremiumBps: 1000,
      };
      const response = await fetch("/api/admin/product-engine/recommend-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Price recommendation failed");
      setResult(payload.recommendation as Recommendation);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Price recommendation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dn-card mt-6 min-w-0 overflow-hidden p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-forest">Dynamic pricing</p>
          <h2 className="mt-1 font-display text-xl font-semibold text-forest-ink">Safe Price Calculator</h2>
          <p className="mt-1 max-w-3xl text-sm text-forest-muted">
            Calculates a recommended DealForge price from landed cost and conservative reserves. It never changes a product or enables commerce.
          </p>
        </div>
        <span className="rounded-full border border-card-border px-3 py-1 text-xs font-semibold text-forest-muted">Recommendation only</span>
      </div>

      <form onSubmit={calculate} className="mt-5 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-medium text-forest-muted">Item cost ($)<input required inputMode="decimal" value={itemCost} onChange={(e) => setItemCost(e.target.value)} placeholder="25.00" className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-forest-ink" /></label>
        <label className="text-xs font-medium text-forest-muted">Shipping ($)<input required inputMode="decimal" value={shipping} onChange={(e) => setShipping(e.target.value)} className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-forest-ink" /></label>
        <label className="text-xs font-medium text-forest-muted">Tax ($)<input required inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-forest-ink" /></label>
        <label className="text-xs font-medium text-forest-muted">Supplier fee ($)<input required inputMode="decimal" value={supplierFee} onChange={(e) => setSupplierFee(e.target.value)} className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-forest-ink" /></label>
        <label className="text-xs font-medium text-forest-muted">Handling ($)<input required inputMode="decimal" value={handling} onChange={(e) => setHandling(e.target.value)} className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-forest-ink" /></label>
        <label className="text-xs font-medium text-forest-muted">Acquisition reserve ($)<input required inputMode="decimal" value={acquisitionReserve} onChange={(e) => setAcquisitionReserve(e.target.value)} className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-forest-ink" /></label>
        <label className="text-xs font-medium text-forest-muted">Market reference ($, optional)<input inputMode="decimal" value={marketReference} onChange={(e) => setMarketReference(e.target.value)} placeholder="39.99" className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-forest-ink" /></label>
        <div className="flex items-end"><button disabled={busy} type="submit" className="w-full rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Calculating…" : "Suggest safe price"}</button></div>
      </form>

      {error ? <p role="alert" className="mt-4 text-sm text-red-700">{error}</p> : null}
      {result ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <article className="rounded-xl border border-card-border p-4"><p className="text-xs text-forest-muted">Recommended price</p><p className="mt-1 text-2xl font-bold text-forest">{money(result.recommendedPriceCents)}</p></article>
          <article className="rounded-xl border border-card-border p-4"><p className="text-xs text-forest-muted">Landed cost</p><p className="mt-1 text-lg font-semibold text-forest-ink">{money(result.landedCostCents)}</p></article>
          <article className="rounded-xl border border-card-border p-4"><p className="text-xs text-forest-muted">Estimated contribution profit</p><p className="mt-1 text-lg font-semibold text-forest-ink">{money(result.contributionProfitCents)}</p></article>
          <article className="rounded-xl border border-card-border p-4"><p className="text-xs text-forest-muted">Contribution margin</p><p className="mt-1 text-lg font-semibold text-forest-ink">{(result.contributionMarginBps / 100).toFixed(1)}%</p></article>
          <div className="sm:col-span-2 lg:col-span-4 rounded-xl border border-card-border bg-forest/5 px-4 py-3 text-sm text-forest-muted">
            Reserves: {money(result.reserveTotalCents)} · Minimum safe: {money(result.minimumSafePriceCents)} · Market check: <strong className="text-forest-ink">{result.marketCompatible ? "compatible" : "above market ceiling"}</strong>{result.marketCeilingCents !== null ? ` (${money(result.marketCeilingCents)} ceiling)` : ""}.
            {!result.marketCompatible ? " DealForge will not underprice below its profit floor to match the market." : ""}
          </div>
        </div>
      ) : null}
    </section>
  );
}
