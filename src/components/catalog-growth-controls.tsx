"use client";

import { useMemo, useState } from "react";

type PreviewRow = {
  row: number;
  canonicalId: string;
  supplierKey: string;
  title: string;
  category: string;
  landedCostCents: number;
  recommendedPriceCents: number;
  stageable: boolean;
};

type BundleSuggestion = {
  key: string;
  title: string;
  productIds: string[];
  recommendedPriceCents: number;
  contributionProfitCents: number;
  contributionMarginBps: number;
  customerSavingsCents: number;
};

const SAMPLE_HEADER = "supplier_name,supplier_key,source_class,external_id,upc,gtin,mpn,title,brand,category,source_url,image_url,currency,item_cost,shipping,supplier_fee,handling,availability,inventory_confidence_bps,observed_at";

async function postCatalogGrowth(body: unknown) {
  const response = await fetch("/api/admin/catalog-growth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`);
  return payload;
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function CatalogGrowthControls() {
  const [csv, setCsv] = useState(SAMPLE_HEADER);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [suggestions, setSuggestions] = useState<BundleSuggestion[]>([]);
  const [bundleTitle, setBundleTitle] = useState("");
  const [bundleProductIds, setBundleProductIds] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const stageable = useMemo(() => preview.filter((row) => row.stageable).length, [preview]);

  async function run(action: string, operation: () => Promise<void>) {
    if (busy) return;
    setBusy(action);
    setMessage("");
    try {
      await operation();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="dn-card p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-forest">Supplier Intake v2</p>
        <h2 className="mt-1 font-display text-2xl font-semibold text-forest-ink">Preview and stage supplier CSV</h2>
        <p className="mt-2 text-sm text-forest-muted">
          CSV rows are normalized and priced, then staged in quarantine. Staging does not authorize resale or enable checkout.
        </p>
        <textarea
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
          rows={10}
          spellCheck={false}
          className="mt-4 w-full rounded-xl border border-card-border bg-background p-3 font-mono text-xs text-forest-ink"
          aria-label="Supplier CSV"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => run("preview", async () => {
              const result = await postCatalogGrowth({ action: "preview_supplier_csv", csv });
              setPreview((result.rows as PreviewRow[]) ?? []);
              setMessage(`Previewed ${Number(result.total ?? 0)} rows; ${Number(result.stageable ?? 0)} stageable.`);
            })}
            className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy === "preview" ? "Previewing…" : "Preview CSV"}
          </button>
          <button
            type="button"
            disabled={Boolean(busy) || !preview.length}
            onClick={() => run("stage", async () => {
              const result = await postCatalogGrowth({ action: "stage_supplier_csv", csv });
              setMessage(`Staged ${Number(result.total ?? 0)} rows; ${Number(result.duplicates ?? 0)} already existed.`);
            })}
            className="rounded-full border border-card-border px-4 py-2 text-sm font-semibold text-forest-ink disabled:opacity-60"
          >
            {busy === "stage" ? "Staging…" : `Stage ${stageable || "eligible"} rows`}
          </button>
        </div>

        {preview.length ? (
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-[760px] w-full text-left text-xs">
              <thead className="text-forest-muted">
                <tr>
                  <th className="pb-2 pr-3">Row</th><th className="pb-2 pr-3">Product</th><th className="pb-2 pr-3">Supplier</th><th className="pb-2 pr-3">Category</th><th className="pb-2 pr-3">Cost</th><th className="pb-2 pr-3">Suggested</th><th className="pb-2">State</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 100).map((row) => (
                  <tr key={`${row.row}:${row.canonicalId}`} className="border-t border-card-border">
                    <td className="py-2 pr-3">{row.row}</td>
                    <td className="max-w-[240px] truncate py-2 pr-3" title={row.title}>{row.title}</td>
                    <td className="py-2 pr-3">{row.supplierKey}</td>
                    <td className="py-2 pr-3">{row.category}</td>
                    <td className="py-2 pr-3">{money(row.landedCostCents)}</td>
                    <td className="py-2 pr-3">{money(row.recommendedPriceCents)}</td>
                    <td className="py-2">{row.stageable ? "Ready to stage" : "Duplicate"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="dn-card p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-forest">Bundle proposals</p>
        <h2 className="mt-1 font-display text-2xl font-semibold text-forest-ink">Build or discover bundles</h2>
        <p className="mt-2 text-sm text-forest-muted">
          Proposals require verified component prices, in-stock state, compatible currency, minimum safe profit, and customer savings.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_2fr_auto]">
          <input
            value={bundleTitle}
            onChange={(event) => setBundleTitle(event.target.value)}
            placeholder="Bundle title"
            className="rounded-xl border border-card-border bg-background px-3 py-2 text-sm"
          />
          <input
            value={bundleProductIds}
            onChange={(event) => setBundleProductIds(event.target.value)}
            placeholder="2–8 product IDs, comma separated"
            className="rounded-xl border border-card-border bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => run("bundle", async () => {
              const productIds = bundleProductIds.split(",").map((value) => value.trim()).filter(Boolean);
              const result = await postCatalogGrowth({ action: "propose_bundle", title: bundleTitle, productIds });
              const proposal = result.proposal as BundleSuggestion & { eligible?: boolean; reasons?: string[] };
              setMessage(proposal.eligible
                ? `Bundle proposal passed: ${money(proposal.recommendedPriceCents)} with ${money(proposal.customerSavingsCents)} customer savings.`
                : `Bundle quarantined: ${(proposal.reasons ?? []).join(", ")}`);
            })}
            className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy === "bundle" ? "Checking…" : "Check bundle"}
          </button>
        </div>
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => run("suggest", async () => {
            const result = await postCatalogGrowth({ action: "suggest_bundles", limit: 10 });
            setSuggestions((result.suggestions as BundleSuggestion[]) ?? []);
            setMessage(`Found ${Number(result.total ?? 0)} eligible bundle candidates.`);
          })}
          className="mt-3 rounded-full border border-card-border px-4 py-2 text-sm font-semibold text-forest-ink disabled:opacity-60"
        >
          {busy === "suggest" ? "Scanning…" : "Find bundle opportunities"}
        </button>

        {suggestions.length ? (
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {suggestions.map((proposal) => (
              <article key={proposal.key} className="rounded-xl border border-card-border p-4">
                <p className="font-semibold text-forest-ink">{proposal.title}</p>
                <p className="mt-2 text-xs text-forest-muted">{proposal.productIds.length} products</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div><span className="block text-forest-muted">Price</span><strong>{money(proposal.recommendedPriceCents)}</strong></div>
                  <div><span className="block text-forest-muted">Profit</span><strong>{money(proposal.contributionProfitCents)}</strong></div>
                  <div><span className="block text-forest-muted">Savings</span><strong>{money(proposal.customerSavingsCents)}</strong></div>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      {message ? <p role="status" className="text-sm text-forest-muted">{message}</p> : null}
    </div>
  );
}
