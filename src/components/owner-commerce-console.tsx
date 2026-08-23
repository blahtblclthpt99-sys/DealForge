"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Calculator,
  ExternalLink,
  Power,
  PowerOff,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
} from "lucide-react";

type CommerceProduct = {
  id: string;
  asin: string | null;
  slug: string;
  title: string;
  brand: string;
  retailer: string;
  sourceUrl: string;
  availability: string;
  referencePrice: number | null;
  commerceEnabled: boolean;
  landedCostCents: number | null;
  sellingPriceCents: number | null;
  currency: string;
  lastUpdated: string;
  recommendation: null | {
    status: string | null;
    assessedAt: string | null;
    sourceCheckedAt: string | null;
    sourceVerified: boolean;
    sourceAvailable: boolean;
    maxSourceAgeMs: number | null;
    profitabilityScore: number | null;
    profitabilityTier: string | null;
    reviewedRetailer: string | null;
    reviewedSourceUrl: string | null;
    reviewedAsin: string | null;
  };
  activation: null | { status: string | null; activatedAt: string | null };
  deactivation: null | { status: string | null; deactivatedAt: string | null; reason: string | null };
};

type Assessment = {
  eligible: boolean;
  reason: string;
  landedCostCents: number | null;
  recommendedSellingPriceCents: number | null;
  estimatedPaymentFeeCents: number | null;
  estimatedProfitCents: number | null;
  grossMarginBps: number | null;
  profitabilityScore: number | null;
  profitabilityTier: string;
};

type ProductResponse = { ok?: boolean; items?: CommerceProduct[]; error?: string };
type AssessmentResponse = { ok?: boolean; assessment?: Assessment; error?: string };

type FormState = {
  itemCost: string;
  shipping: string;
  estimatedTax: string;
  handling: string;
  procurementBuffer: string;
  otherCost: string;
  targetMarginPercent: string;
  minimumProfit: string;
  paymentFeePercent: string;
  paymentFixedFee: string;
  priceFloor: string;
  priceCeiling: string;
  sourceCheckedAt: string;
  maxSourceAgeHours: string;
  sourceVerified: boolean;
  sourceAvailable: boolean;
};

const EMPTY_FORM: FormState = {
  itemCost: "",
  shipping: "0",
  estimatedTax: "0",
  handling: "0",
  procurementBuffer: "0",
  otherCost: "0",
  targetMarginPercent: "",
  minimumProfit: "0",
  paymentFeePercent: "",
  paymentFixedFee: "",
  priceFloor: "",
  priceCeiling: "",
  sourceCheckedAt: "",
  maxSourceAgeHours: "24",
  sourceVerified: false,
  sourceAvailable: false,
};

function dollars(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function cents(value: number | null) {
  return value == null ? "—" : dollars(value / 100);
}

function parseDollars(value: string, label: string, allowEmpty = false) {
  const trimmed = value.trim();
  if (!trimmed && allowEmpty) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be a valid non-negative dollar amount.`);
  const result = Math.round(parsed * 100);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} is too large.`);
  return result;
}

function parsePercentBps(value: string, label: string, allowEmpty = false) {
  const trimmed = value.trim();
  if (!trimmed && allowEmpty) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 100) throw new Error(`${label} must be between 0 and 99.99%.`);
  const result = Math.round(parsed * 100);
  if (!Number.isSafeInteger(result) || result > 9_999) throw new Error(`${label} is invalid.`);
  return result;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : "—";
}

function fieldClass() {
  return "min-h-11 w-full rounded-xl border border-card-border bg-background px-3 py-2.5 text-sm text-forest-ink outline-none focus:border-[#F97316]/60 focus:ring-2 focus:ring-[#F97316]/15";
}

export function OwnerCommerceConsole() {
  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "inactive" | "active">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fulfillment, setFulfillment] = useState({
    sourceOrderable: false,
    customerDeliverySupported: false,
    returnsSupportReady: false,
    manualProcurementAcknowledged: false,
  });
  const [deactivationReason, setDeactivationReason] = useState("manual_pause");
  const [deactivationNote, setDeactivationNote] = useState("");

  const selected = useMemo(
    () => products.find((product) => product.id === selectedId) ?? null,
    [products, selectedId],
  );

  useEffect(() => {
    void loadProducts("", "all");
  }, []);

  async function loadProducts(nextQuery = query, nextFilter = filter) {
    setBusy("search");
    setError(null);
    try {
      const params = new URLSearchParams();
      if (nextQuery.trim()) params.set("q", nextQuery.trim());
      if (nextFilter === "active") params.set("active", "true");
      if (nextFilter === "inactive") params.set("active", "false");
      const response = await fetch(`/api/admin/commerce/products?${params.toString()}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as ProductResponse;
      if (!response.ok) throw new Error(data.error || "Could not load commerce products.");
      const items = data.items ?? [];
      setProducts(items);
      if (selectedId && !items.some((item) => item.id === selectedId)) setSelectedId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load commerce products.");
    } finally {
      setBusy(null);
    }
  }

  function chooseProduct(product: CommerceProduct) {
    setSelectedId(product.id);
    setAssessment(null);
    setSaved(Boolean(product.recommendation && !product.commerceEnabled));
    setMessage(null);
    setError(null);
    setFulfillment({
      sourceOrderable: false,
      customerDeliverySupported: false,
      returnsSupportReady: false,
      manualProcurementAcknowledged: false,
    });
  }

  function buildCommercePayload() {
    const sourceCheckedAtMs = Date.parse(form.sourceCheckedAt);
    if (!Number.isSafeInteger(sourceCheckedAtMs) || sourceCheckedAtMs <= 0) {
      throw new Error("Enter the actual date and time the supplier source was verified.");
    }
    const maxSourceAgeHours = Number(form.maxSourceAgeHours);
    if (!Number.isFinite(maxSourceAgeHours) || maxSourceAgeHours <= 0 || maxSourceAgeHours > 168) {
      throw new Error("Source freshness window must be between 0 and 168 hours.");
    }
    const maxSourceAgeMs = Math.round(maxSourceAgeHours * 3_600_000);
    if (!Number.isSafeInteger(maxSourceAgeMs) || maxSourceAgeMs <= 0) throw new Error("Source freshness window is invalid.");

    const itemCostCents = parseDollars(form.itemCost, "Supplier item cost");
    if (!itemCostCents) throw new Error("Supplier item cost must be greater than $0.");

    return {
      currency: "usd" as const,
      landedCost: {
        itemCostCents,
        shippingCents: parseDollars(form.shipping, "Shipping")!,
        estimatedTaxCents: parseDollars(form.estimatedTax, "Estimated tax")!,
        handlingCents: parseDollars(form.handling, "Handling")!,
        procurementBufferCents: parseDollars(form.procurementBuffer, "Procurement buffer")!,
        otherCostCents: parseDollars(form.otherCost, "Other cost")!,
        sourceVerified: form.sourceVerified,
        sourceAvailable: form.sourceAvailable,
        sourceCheckedAtMs,
        maxSourceAgeMs,
      },
      pricing: {
        targetGrossMarginBps: parsePercentBps(form.targetMarginPercent, "Target gross margin")!,
        minimumProfitCents: parseDollars(form.minimumProfit, "Minimum profit")!,
        paymentFeeBps: parsePercentBps(form.paymentFeePercent, "Payment fee")!,
        paymentFixedFeeCents: parseDollars(form.paymentFixedFee, "Payment fixed fee")!,
        priceFloorCents: parseDollars(form.priceFloor, "Price floor", true),
        priceCeilingCents: parseDollars(form.priceCeiling, "Price ceiling", true),
      },
    };
  }

  async function assess() {
    setBusy("assess");
    setMessage(null);
    setError(null);
    try {
      const payload = buildCommercePayload();
      const response = await fetch("/api/admin/commerce/assess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({})) as AssessmentResponse;
      if (!data.assessment) throw new Error(data.error || "Assessment did not return a result.");
      setAssessment(data.assessment);
      setSaved(false);
      if (!response.ok || !data.assessment.eligible) {
        setError(`Assessment blocked: ${data.assessment.reason}`);
        return;
      }
      setMessage("Assessment passed. Review the numbers, then save the recommendation.");
    } catch (cause) {
      setAssessment(null);
      setSaved(false);
      setError(cause instanceof Error ? cause.message : "Assessment failed.");
    } finally {
      setBusy(null);
    }
  }

  async function saveRecommendation() {
    if (!selected) return;
    setBusy("save");
    setMessage(null);
    setError(null);
    try {
      const payload = buildCommercePayload();
      const response = await fetch(`/api/admin/commerce/products/${encodeURIComponent(selected.id)}/recommendation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, confirm: "SAVE_RECOMMENDATION" }),
      });
      const data = await response.json().catch(() => ({})) as AssessmentResponse;
      if (!response.ok) throw new Error(data.error || "Recommendation could not be saved.");
      if (data.assessment) setAssessment(data.assessment);
      setSaved(true);
      setMessage("Reviewed recommendation saved. Fulfillment checks are still required before activation.");
      await loadProducts(query, filter);
    } catch (cause) {
      setSaved(false);
      setError(cause instanceof Error ? cause.message : "Recommendation could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  async function activate() {
    if (!selected) return;
    if (!Object.values(fulfillment).every(Boolean)) {
      setError("Confirm every fulfillment readiness item before activation.");
      return;
    }
    setBusy("activate");
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/admin/commerce/products/${encodeURIComponent(selected.id)}/activation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: "ACTIVATE_DIRECT_COMMERCE",
          fulfillment,
        }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; reason?: string };
      if (!response.ok) throw new Error(data.reason ? `${data.error || "Activation blocked"}: ${data.reason}` : data.error || "Activation blocked.");
      setMessage("Direct commerce activated. Runtime readiness will continue to fail closed if source or financial state becomes stale.");
      setAssessment(null);
      setSaved(false);
      await loadProducts(query, filter);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Activation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function deactivate() {
    if (!selected) return;
    setBusy("deactivate");
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/admin/commerce/products/${encodeURIComponent(selected.id)}/deactivation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: "DEACTIVATE_DIRECT_COMMERCE",
          reason: deactivationReason,
          note: deactivationNote.trim() || undefined,
        }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Deactivation failed.");
      setMessage("Direct commerce deactivated immediately.");
      setDeactivationNote("");
      await loadProducts(query, filter);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Deactivation failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="dn-card mt-8 overflow-hidden border-emerald-500/25 p-5 sm:p-6" aria-labelledby="owner-commerce-console">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="h-3.5 w-3.5" /> Owner commerce gate
          </div>
          <h2 id="owner-commerce-console" className="mt-3 font-display text-2xl font-semibold text-forest-ink">
            Direct commerce control center
          </h2>
          <p className="mt-2 text-sm leading-6 text-forest-muted">
            Review real supplier costs, calculate a DealForge selling price, save the recommendation, then activate only after fulfillment is ready. Supplier purchasing remains manual.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadProducts(query, filter)}
          disabled={busy !== null}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-card-border bg-background px-4 py-2 text-sm font-bold text-forest disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${busy === "search" ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <form
        className="mt-6 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          void loadProducts(query, filter);
        }}
      >
        <label>
          <span className="sr-only">Search products</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value.slice(0, 120))}
            placeholder="Search title, brand, ASIN, or product ID"
            className={fieldClass()}
          />
        </label>
        <button type="submit" disabled={busy !== null} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-forest px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
          <Search className="h-4 w-4" /> Search
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {(["all", "inactive", "active"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setFilter(option);
              void loadProducts(query, option);
            }}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold capitalize ${filter === option ? "border-forest bg-forest text-white" : "border-card-border text-forest-muted"}`}
          >
            {option === "inactive" ? "Candidates" : option === "active" ? "Live" : "All"}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,.78fr)_minmax(0,1.22fr)]">
        <div className="max-h-[42rem] space-y-2 overflow-y-auto pr-1">
          {products.length ? products.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => chooseProduct(product)}
              className={`w-full rounded-2xl border p-4 text-left transition ${selectedId === product.id ? "border-[#F97316]/60 bg-[#F97316]/5" : "border-card-border bg-background hover:border-forest/30"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-forest-ink">{product.title}</p>
                  <p className="mt-1 truncate text-xs text-forest-muted">{product.brand || product.retailer} · {product.asin || product.id}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${product.commerceEnabled ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-card text-forest-muted"}`}>
                  {product.commerceEnabled ? "Live" : product.recommendation ? "Reviewed" : "Candidate"}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div><span className="block text-forest-muted">Reference</span><strong className="text-forest-ink">{dollars(product.referencePrice)}</strong></div>
                <div><span className="block text-forest-muted">Landed</span><strong className="text-forest-ink">{cents(product.landedCostCents)}</strong></div>
                <div><span className="block text-forest-muted">Sell</span><strong className="text-forest">{cents(product.sellingPriceCents)}</strong></div>
              </div>
            </button>
          )) : (
            <div className="rounded-2xl border border-dashed border-card-border p-6 text-sm text-forest-muted">No products matched this view.</div>
          )}
        </div>

        <div className="min-w-0">
          {!selected ? (
            <div className="rounded-2xl border border-dashed border-card-border p-8 text-center text-sm text-forest-muted">
              Select a product to review its commerce readiness.
            </div>
          ) : (
            <div className="space-y-5">
              <div className="rounded-2xl border border-card-border bg-background p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-forest-ink">{selected.title}</p>
                    <p className="mt-1 text-xs text-forest-muted">{selected.retailer} · {selected.asin || "No ASIN"} · {selected.availability}</p>
                  </div>
                  <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-forest hover:underline">
                    Verify source <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div><p className="text-[10px] uppercase text-forest-muted">Reference only</p><p className="font-bold text-forest-ink">{dollars(selected.referencePrice)}</p></div>
                  <div><p className="text-[10px] uppercase text-forest-muted">Saved landed</p><p className="font-bold text-forest-ink">{cents(selected.landedCostCents)}</p></div>
                  <div><p className="text-[10px] uppercase text-forest-muted">DealForge price</p><p className="font-bold text-forest">{cents(selected.sellingPriceCents)}</p></div>
                  <div><p className="text-[10px] uppercase text-forest-muted">State</p><p className="font-bold text-forest-ink">{selected.commerceEnabled ? "Live" : "Inactive"}</p></div>
                </div>
                <p className="mt-3 text-[11px] leading-5 text-forest-muted">The reference price above is informational only. It is never copied into landed cost automatically.</p>
              </div>

              {!selected.commerceEnabled ? (
                <>
                  <div className="rounded-2xl border border-card-border bg-background p-4 sm:p-5">
                    <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-forest-ink"><Calculator className="h-4 w-4 text-[#F97316]" /> 1. Verified cost & pricing policy</h3>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {[
                        ["Supplier item cost ($)", "itemCost"],
                        ["Shipping ($)", "shipping"],
                        ["Estimated tax ($)", "estimatedTax"],
                        ["Handling ($)", "handling"],
                        ["Procurement buffer ($)", "procurementBuffer"],
                        ["Other unavoidable cost ($)", "otherCost"],
                        ["Target gross margin (%)", "targetMarginPercent"],
                        ["Minimum profit ($)", "minimumProfit"],
                        ["Payment fee (%)", "paymentFeePercent"],
                        ["Payment fixed fee ($)", "paymentFixedFee"],
                        ["Price floor ($, optional)", "priceFloor"],
                        ["Price ceiling ($, optional)", "priceCeiling"],
                      ].map(([label, key]) => (
                        <label key={key} className="text-xs font-semibold text-forest-muted">
                          {label}
                          <input
                            inputMode="decimal"
                            value={form[key as keyof FormState] as string}
                            onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                            className={`${fieldClass()} mt-1.5`}
                          />
                        </label>
                      ))}
                      <label className="text-xs font-semibold text-forest-muted">
                        Source checked at
                        <input type="datetime-local" value={form.sourceCheckedAt} onChange={(event) => setForm((current) => ({ ...current, sourceCheckedAt: event.target.value }))} className={`${fieldClass()} mt-1.5`} />
                      </label>
                      <label className="text-xs font-semibold text-forest-muted">
                        Freshness window (hours)
                        <input inputMode="decimal" value={form.maxSourceAgeHours} onChange={(event) => setForm((current) => ({ ...current, maxSourceAgeHours: event.target.value }))} className={`${fieldClass()} mt-1.5`} />
                      </label>
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <label className="flex min-h-11 items-center gap-3 rounded-xl border border-card-border px-3 py-2 text-sm text-forest-ink">
                        <input type="checkbox" checked={form.sourceVerified} onChange={(event) => setForm((current) => ({ ...current, sourceVerified: event.target.checked }))} />
                        I verified this supplier/source data
                      </label>
                      <label className="flex min-h-11 items-center gap-3 rounded-xl border border-card-border px-3 py-2 text-sm text-forest-ink">
                        <input type="checkbox" checked={form.sourceAvailable} onChange={(event) => setForm((current) => ({ ...current, sourceAvailable: event.target.checked }))} />
                        Source currently shows item available
                      </label>
                    </div>
                    <button type="button" onClick={() => void assess()} disabled={busy !== null} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-forest px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                      <Calculator className="h-4 w-4" /> {busy === "assess" ? "Assessing…" : "Assess profitability"}
                    </button>
                  </div>

                  {assessment ? (
                    <div className={`rounded-2xl border p-4 sm:p-5 ${assessment.eligible ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div><p className="text-xs font-bold uppercase tracking-wide text-forest-muted">Assessment</p><p className="mt-1 text-lg font-bold text-forest-ink">{assessment.eligible ? "Eligible for owner review" : `Blocked: ${assessment.reason}`}</p></div>
                        <span className="rounded-full border border-card-border px-3 py-1 text-xs font-bold text-forest-ink">{assessment.profitabilityTier} · {assessment.profitabilityScore ?? 0}/100</span>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div><p className="text-[10px] uppercase text-forest-muted">Landed cost</p><p className="font-bold text-forest-ink">{cents(assessment.landedCostCents)}</p></div>
                        <div><p className="text-[10px] uppercase text-forest-muted">Recommended sell</p><p className="font-bold text-forest">{cents(assessment.recommendedSellingPriceCents)}</p></div>
                        <div><p className="text-[10px] uppercase text-forest-muted">Est. profit</p><p className="font-bold text-forest-ink">{cents(assessment.estimatedProfitCents)}</p></div>
                        <div><p className="text-[10px] uppercase text-forest-muted">Gross margin</p><p className="font-bold text-forest-ink">{assessment.grossMarginBps == null ? "—" : `${(assessment.grossMarginBps / 100).toFixed(2)}%`}</p></div>
                      </div>
                      {assessment.eligible ? (
                        <button type="button" onClick={() => void saveRecommendation()} disabled={busy !== null} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#F97316] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                          <Save className="h-4 w-4" /> {busy === "save" ? "Saving…" : "Save reviewed recommendation"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {(saved || selected.recommendation) ? (
                    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5">
                      <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-forest-ink"><ShieldCheck className="h-4 w-4 text-amber-600" /> 2. Fulfillment readiness</h3>
                      {selected.recommendation ? <p className="mt-2 text-xs text-forest-muted">Latest saved recommendation: {formatDate(selected.recommendation.assessedAt)} · source checked {formatDate(selected.recommendation.sourceCheckedAt)}</p> : null}
                      <div className="mt-4 grid gap-2">
                        {[
                          ["sourceOrderable", "I can order this exact item from the reviewed source"],
                          ["customerDeliverySupported", "The supplier can deliver to supported customer destinations"],
                          ["returnsSupportReady", "Returns/refund support is operationally ready"],
                          ["manualProcurementAcknowledged", "I understand supplier purchasing remains manual"],
                        ].map(([key, label]) => (
                          <label key={key} className="flex min-h-11 items-center gap-3 rounded-xl border border-card-border bg-background px-3 py-2 text-sm text-forest-ink">
                            <input type="checkbox" checked={fulfillment[key as keyof typeof fulfillment]} onChange={(event) => setFulfillment((current) => ({ ...current, [key]: event.target.checked }))} />
                            {label}
                          </label>
                        ))}
                      </div>
                      <button type="button" onClick={() => void activate()} disabled={busy !== null || !Object.values(fulfillment).every(Boolean)} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                        <Power className="h-4 w-4" /> {busy === "activate" ? "Activating…" : "Activate direct commerce"}
                      </button>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="rounded-2xl border border-red-500/25 bg-red-500/5 p-4 sm:p-5">
                  <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-forest-ink"><PowerOff className="h-4 w-4 text-red-600" /> Live-product kill switch</h3>
                  <p className="mt-2 text-sm leading-6 text-forest-muted">Deactivation stops new DealForge checkouts for this product. Existing paid orders remain intact.</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-semibold text-forest-muted">Reason
                      <select value={deactivationReason} onChange={(event) => setDeactivationReason(event.target.value)} className={`${fieldClass()} mt-1.5`}>
                        <option value="manual_pause">Manual pause</option>
                        <option value="source_changed">Source changed</option>
                        <option value="pricing_review">Pricing review</option>
                        <option value="fulfillment_pause">Fulfillment pause</option>
                        <option value="emergency">Emergency</option>
                      </select>
                    </label>
                    <label className="text-xs font-semibold text-forest-muted">Note (optional)
                      <input value={deactivationNote} onChange={(event) => setDeactivationNote(event.target.value.slice(0, 300))} className={`${fieldClass()} mt-1.5`} />
                    </label>
                  </div>
                  <button type="button" onClick={() => void deactivate()} disabled={busy !== null} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-700 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                    <PowerOff className="h-4 w-4" /> {busy === "deactivate" ? "Deactivating…" : "Deactivate now"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {message ? <p role="status" className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">{message}</p> : null}
      {error ? <p role="alert" className="mt-5 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
    </section>
  );
}
