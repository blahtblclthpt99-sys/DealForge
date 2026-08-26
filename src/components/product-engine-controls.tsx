"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type CandidateRow = {
  id: string;
  asin: string;
  title: string | null;
  state: string;
  score: number;
  category: string | null;
  rejectionReason: string | null;
};

type ProductRow = {
  id: string;
  title: string;
  slug: string;
  commerceEnabled: boolean;
  sellingPriceCents: number | null;
  landedCostCents: number | null;
  availability: string;
  priceSource: string | null;
  priceVerifiedAt: string | null;
};

type SourceType = "owner_asin" | "owner_special_link" | "public_reference";
type DirectSourceClass = "manufacturer" | "wholesale" | "distributor" | "authorized_dropshipper" | "retailer_permitting_resale";

async function engineAction(body: Record<string, unknown>) {
  const res = await fetch("/api/admin/product-engine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Product Engine action failed");
  return payload;
}

function dollarsToCents(value: string, field: string, allowZero = false) {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) throw new Error(`${field} must be a valid dollar amount`);
  const cents = Math.round(Number(trimmed) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0 || (!allowZero && cents === 0)) throw new Error(`${field} is invalid`);
  return cents;
}

function formatMoney(cents: number | null) {
  return cents === null ? "—" : `$${(cents / 100).toFixed(2)}`;
}

export function ProductEngineControls({ paused, candidates, products }: { paused: boolean; candidates: CandidateRow[]; products: ProductRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [asin, setAsin] = useState("");
  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [specialLink, setSpecialLink] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("owner_asin");
  const [scout, setScout] = useState<"scout-a" | "scout-b">("scout-a");

  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [supplierName, setSupplierName] = useState("");
  const [sourceClass, setSourceClass] = useState<DirectSourceClass>("authorized_dropshipper");
  const [supplierUrl, setSupplierUrl] = useState("");
  const [itemCost, setItemCost] = useState("");
  const [shippingCost, setShippingCost] = useState("0");
  const [taxCost, setTaxCost] = useState("0");
  const [supplierFee, setSupplierFee] = useState("0");
  const [handlingCost, setHandlingCost] = useState("0");
  const [sellingPrice, setSellingPrice] = useState("");
  const [inventoryConfidence, setInventoryConfidence] = useState("95");
  const [acquisitionReserve, setAcquisitionReserve] = useState("0");
  const [availability, setAvailability] = useState<"in_stock" | "out_of_stock" | "unknown">("in_stock");
  const [taxClassification, setTaxClassification] = useState("General tangible personal property");
  const [stripeTaxCode, setStripeTaxCode] = useState("txcd_99999999");
  const [taxVerificationSource, setTaxVerificationSource] = useState("owner_manual_stripe_tax_review");

  async function act(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      const payload = await engineAction(body);
      const decision = payload?.decision as { reasons?: string[]; contributionProfitCents?: number | null; contributionMarginBps?: number | null } | undefined;
      if (body.action === "commercialize" && payload?.commerceReady === false) {
        const reasons = Array.isArray(decision?.reasons) ? decision.reasons.join(", ") : "commercial gate blocked";
        setMessage(`Saved verified source and tax evidence, but commerce remains blocked: ${reasons}.`);
      } else if (body.action === "commercialize" && payload?.commerceReady === true) {
        const profit = typeof decision?.contributionProfitCents === "number" ? formatMoney(decision.contributionProfitCents) : "verified";
        const margin = typeof decision?.contributionMarginBps === "number" ? `${(decision.contributionMarginBps / 100).toFixed(1)}%` : "verified";
        setMessage(`Commercial gate passed. Tax classification, source, inventory, landed cost and profit are all bound. Estimated contribution profit ${profit}; margin ${margin}.`);
      } else {
        setMessage(success);
      }
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function intake(e: React.FormEvent) {
    e.preventDefault();
    await act({
      action: "intake",
      asin,
      title: title || undefined,
      brand: brand || undefined,
      category: category || undefined,
      ownerSpecialLink: sourceType === "owner_special_link" ? specialLink || undefined : undefined,
      sourceUrl: sourceType === "public_reference" ? sourceUrl || undefined : undefined,
      sourceType,
      scout,
    }, "Candidate accepted into the queue.");
    setAsin("");
    setTitle("");
    setBrand("");
    setCategory("");
    setSpecialLink("");
    setSourceUrl("");
  }

  async function commercialize(e: React.FormEvent) {
    e.preventDefault();
    if (!productId) {
      setMessage("Choose a product before running the commercial gate.");
      return;
    }
    try {
      const confidence = Number(inventoryConfidence);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) throw new Error("Inventory confidence must be 0–100%.");
      if (!/^txcd_[A-Za-z0-9]+$/.test(stripeTaxCode.trim())) throw new Error("Stripe tax code must start with txcd_.");
      if (!taxClassification.trim()) throw new Error("Tax classification is required.");
      if (!taxVerificationSource.trim()) throw new Error("Tax verification source is required.");
      const now = new Date().toISOString();
      await act({
        action: "commercialize",
        productId,
        supplierName,
        sourceClass,
        sourceUrl: supplierUrl || undefined,
        resaleAllowed: true,
        sourceVerifiedAt: now,
        priceVerifiedAt: now,
        itemCostCents: dollarsToCents(itemCost, "Item cost"),
        shippingCents: dollarsToCents(shippingCost, "Shipping", true),
        taxCents: dollarsToCents(taxCost, "Tax", true),
        supplierFeeCents: dollarsToCents(supplierFee, "Supplier fee", true),
        handlingCents: dollarsToCents(handlingCost, "Handling", true),
        sellingPriceCents: dollarsToCents(sellingPrice, "Selling price"),
        inventoryConfidenceBps: Math.round(confidence * 100),
        acquisitionReserveCents: dollarsToCents(acquisitionReserve, "Acquisition reserve", true),
        availability,
        taxClassification: taxClassification.trim(),
        stripeTaxCode: stripeTaxCode.trim(),
        taxVerifiedAt: now,
        taxVerificationSource: taxVerificationSource.trim(),
        taxMaxAgeDays: 365,
      }, "Commercial gate evaluated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Commercial gate input is invalid");
    }
  }

  return (
    <>
      <section className="dn-card mt-8 min-w-0 overflow-hidden p-5">
        <div className="flex flex-wrap gap-3">
          <button disabled={busy} onClick={() => act({ action: "run" }, "Product Engine run completed.")} className="rounded-xl bg-forest px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Run Discovery</button>
          {paused ? (
            <button disabled={busy} onClick={() => act({ action: "resume" }, "Product Engine resumed.")} className="rounded-xl border border-card-border px-4 py-2 text-sm font-semibold text-forest-ink disabled:opacity-50">Resume</button>
          ) : (
            <button disabled={busy} onClick={() => act({ action: "pause" }, "Product Engine paused.")} className="rounded-xl border border-card-border px-4 py-2 text-sm font-semibold text-forest-ink disabled:opacity-50">Pause</button>
          )}
          <a href="#review-queue" className="rounded-xl border border-card-border px-4 py-2 text-sm font-semibold text-forest-ink">Review</a>
          <a href="#commercial-gate" className="rounded-xl border border-card-border px-4 py-2 text-sm font-semibold text-forest-ink">Commerce Gate</a>
        </div>
        <p className="mt-3 text-xs text-forest-muted">Discovery processes owner-supplied candidates and permissible public references. It does not crawl or scrape Amazon.</p>
        {message ? <p role="status" className="mt-3 break-words text-sm text-forest-muted">{message}</p> : null}
      </section>

      <section className="dn-card mt-6 min-w-0 overflow-hidden p-5">
        <h2 className="font-display text-xl font-semibold text-forest-ink">Candidate intake</h2>
        <p className="mt-1 text-sm text-forest-muted">Add an ASIN, an existing Amazon Special Link, or a permissible public reference. DealForge never fetches Amazon HTML from this form.</p>
        <form onSubmit={intake} className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
          <select value={sourceType} onChange={(e) => setSourceType(e.target.value as SourceType)} className="min-w-0 rounded-xl border border-card-border bg-card px-3 py-2 text-sm">
            <option value="owner_asin">Owner-supplied ASIN</option>
            <option value="owner_special_link">Owner Amazon Special Link</option>
            <option value="public_reference">Permissible public reference</option>
          </select>
          <select value={scout} onChange={(e) => setScout(e.target.value as "scout-a" | "scout-b")} className="min-w-0 rounded-xl border border-card-border bg-card px-3 py-2 text-sm"><option value="scout-a">Scout A</option><option value="scout-b">Scout B</option></select>
          <input required value={asin} onChange={(e) => setAsin(e.target.value)} placeholder="ASIN (10 characters)" maxLength={20} className="min-w-0 rounded-xl border border-card-border bg-card px-3 py-2 text-sm" />
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Product title" maxLength={500} className="min-w-0 rounded-xl border border-card-border bg-card px-3 py-2 text-sm" />
          <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand" maxLength={160} className="min-w-0 rounded-xl border border-card-border bg-card px-3 py-2 text-sm" />
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" maxLength={100} className="min-w-0 rounded-xl border border-card-border bg-card px-3 py-2 text-sm" />
          {sourceType === "owner_special_link" ? <input required value={specialLink} onChange={(e) => setSpecialLink(e.target.value)} placeholder="Amazon Special Link" maxLength={2000} className="min-w-0 rounded-xl border border-card-border bg-card px-3 py-2 text-sm sm:col-span-2" /> : null}
          {sourceType === "public_reference" ? <input required value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="Public source URL" maxLength={2000} className="min-w-0 rounded-xl border border-card-border bg-card px-3 py-2 text-sm sm:col-span-2" /> : null}
          <button disabled={busy} type="submit" className="rounded-xl bg-forest px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2">Add candidate</button>
        </form>
      </section>

      <section id="commercial-gate" className="dn-card mt-6 min-w-0 scroll-mt-6 overflow-hidden p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold text-forest-ink">Source, tax & profit gate</h2>
            <p className="mt-1 max-w-3xl text-sm text-forest-muted">A product is commerce-ready only when resale authority, persisted supplier economics, inventory confidence, landed cost, minimum safe profit, and an explicit verified Stripe tax classification all pass together.</p>
          </div>
          <span className="rounded-full border border-card-border px-3 py-1 text-xs font-semibold text-forest-muted">Owner only</span>
        </div>

        {products.length ? (
          <form onSubmit={commercialize} className="mt-5 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="min-w-0 text-xs font-medium text-forest-muted sm:col-span-2 lg:col-span-3">Product
              <select required value={productId} onChange={(e) => setProductId(e.target.value)} className="mt-1 w-full min-w-0 rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-forest-ink">
                {products.map((product) => <option key={product.id} value={product.id}>{product.title} · {product.commerceEnabled ? "commerce ready" : "blocked"}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-forest-muted">Supplier name<input required value={supplierName} onChange={(e) => setSupplierName(e.target.value)} maxLength={160} className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-forest-ink" /></label>
            <label className="text-xs font-medium text-forest-muted">Source class<select value={sourceClass} onChange={(e) => setSourceClass(e.target.value as DirectSourceClass)} className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-forest-ink"><option value="authorized_dropshipper">Authorized dropshipper</option><option value="manufacturer">Manufacturer</option><option value="wholesale">Wholesale</option><option value="distributor">Distributor</option><option value="retailer_permitting_resale">Retailer permitting resale</option></select></label>
            <label className="text-xs font-medium text-forest-muted">Verified supplier URL<input value={supplierUrl} onChange={(e) => setSupplierUrl(e.target.value)} placeholder="https://…" maxLength={2000} className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-forest-ink" /></label>
            <label className="text-xs font-medium text-forest-muted">Tax classification<input required value={taxClassification} onChange={(e) => setTaxClassification(e.target.value)} maxLength={160} className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-forest-ink" /></label>
            <label className="text-xs font-medium text-forest-muted">Stripe tax code<input required value={stripeTaxCode} onChange={(e) => setStripeTaxCode(e.target.value)} placeholder="txcd_…" maxLength={64} className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 font-mono text-sm text-forest-ink" /></label>
            <label className="text-xs font-medium text-forest-muted">Tax verification source<input required value={taxVerificationSource} onChange={(e) => setTaxVerificationSource(e.target.value)} maxLength={160} className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-forest-ink" /></label>
            <label className="text-xs font-medium text-forest-muted">Item cost ($)<input required inputMode="decimal" value={itemCost} onChange={(e) => setItemCost(e.target.value)} placeholder="25.00" className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-forest-ink" /></label>
            <label className="text-xs font-medium text-forest-muted">Shipping ($)<input required inputMode="decimal" value={shippingCost} onChange={(e) => setShippingCost(e.target.value)} className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-forest-ink" /></label>
            <label className="text-xs font-medium text-forest-muted">Supplier tax ($)<input required inputMode="decimal" value={taxCost} onChange={(e) => setTaxCost(e.target.value)} className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-forest-ink" /></label>
            <label className="text-xs font-medium text-forest-muted">Supplier fee ($)<input required inputMode="decimal" value={supplierFee} onChange={(e) => setSupplierFee(e.target.value)} className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-forest-ink" /></label>
            <label className="text-xs font-medium text-forest-muted">Handling ($)<input required inputMode="decimal" value={handlingCost} onChange={(e) => setHandlingCost(e.target.value)} className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-forest-ink" /></label>
            <label className="text-xs font-medium text-forest-muted">Selling price ($)<input required inputMode="decimal" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} placeholder="39.99" className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-forest-ink" /></label>
            <label className="text-xs font-medium text-forest-muted">Inventory confidence (%)<input required inputMode="decimal" value={inventoryConfidence} onChange={(e) => setInventoryConfidence(e.target.value)} className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-forest-ink" /></label>
            <label className="text-xs font-medium text-forest-muted">Acquisition reserve ($)<input required inputMode="decimal" value={acquisitionReserve} onChange={(e) => setAcquisitionReserve(e.target.value)} className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-forest-ink" /></label>
            <label className="text-xs font-medium text-forest-muted">Availability<select value={availability} onChange={(e) => setAvailability(e.target.value as typeof availability)} className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-forest-ink"><option value="in_stock">In stock</option><option value="out_of_stock">Out of stock</option><option value="unknown">Unknown</option></select></label>
            <p className="text-xs text-forest-muted sm:col-span-2 lg:col-span-3">The default tax code is only a starting value. Confirm the exact Stripe Product Tax Code for the selected product before submitting; this evidence is timestamped and becomes part of the immutable checkout authority for that product.</p>
            <div className="flex items-end sm:col-span-2 lg:col-span-3"><button disabled={busy} type="submit" className="w-full rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Verify source + tax, calculate landed cost & run commerce gate</button></div>
          </form>
        ) : <p className="mt-4 text-sm text-forest-muted">No normal catalog products are available for commercialization yet.</p>}

        {products.length ? (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead><tr className="border-b border-card-border text-forest-muted"><th className="p-2">Product</th><th className="p-2">Commerce</th><th className="p-2">Sell</th><th className="p-2">Landed</th><th className="p-2">Availability</th><th className="p-2">Source</th><th className="p-2">Verified</th></tr></thead>
              <tbody>{products.map((product) => <tr key={product.id} className="border-b border-card-border/70"><td className="max-w-[18rem] break-words p-2"><a className="underline" href={`/product/${product.slug}`}>{product.title}</a></td><td className="p-2 font-semibold">{product.commerceEnabled ? "READY" : "BLOCKED"}</td><td className="p-2">{formatMoney(product.sellingPriceCents)}</td><td className="p-2">{formatMoney(product.landedCostCents)}</td><td className="p-2">{product.availability}</td><td className="max-w-[12rem] break-words p-2">{product.priceSource ?? "—"}</td><td className="p-2">{product.priceVerifiedAt ? new Date(product.priceVerifiedAt).toLocaleString() : "—"}</td></tr>)}</tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section id="review-queue" className="dn-card mt-6 min-w-0 scroll-mt-6 overflow-hidden p-5">
        <h2 className="font-display text-xl font-semibold text-forest-ink">Review queue</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead><tr className="border-b border-card-border text-forest-muted"><th className="p-2">ASIN</th><th className="p-2">Title</th><th className="p-2">State</th><th className="p-2">Score</th><th className="p-2">Category</th><th className="p-2">Reason</th><th className="p-2">Actions</th></tr></thead>
            <tbody>
              {candidates.map((candidate) => (
                <tr key={candidate.id} className="border-b border-card-border/70 align-top">
                  <td className="p-2 font-mono">{candidate.asin}</td>
                  <td className="max-w-[16rem] break-words p-2">{candidate.title ?? "—"}</td>
                  <td className="p-2">{candidate.state}</td>
                  <td className="p-2">{candidate.score.toFixed(0)}</td>
                  <td className="p-2">{candidate.category ?? "—"}</td>
                  <td className="max-w-[12rem] break-words p-2">{candidate.rejectionReason ?? "—"}</td>
                  <td className="p-2"><div className="flex gap-2">{["classified", "approved"].includes(candidate.state) ? <button disabled={busy} onClick={() => act({ action: "publish", candidateId: candidate.id }, "Candidate published.")} className="underline">Publish</button> : null}{["dead_letter", "rejected"].includes(candidate.state) ? <button disabled={busy} onClick={() => act({ action: "retry", candidateId: candidate.id }, "Candidate queued for retry.")} className="underline">Retry</button> : null}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
