"use client";

import { useCallback, useState } from "react";

type Variant = {
  externalVariantId: string;
  title: string;
  sku: string | null;
  supplierListedPrice: string;
  observedInventoryQuantity: number | null;
  unitCost: { amount: string; currencyCode: string } | null;
};
type Product = {
  externalProductId: string;
  title: string;
  handle: string;
  vendor: string;
  productType: string;
  status: string;
  updatedAt: string;
  variantsMayBeIncomplete: boolean;
  variants: Variant[];
  sourceVerification: string;
  commerceEnabled: boolean;
};
type CatalogResponse = {
  shopDomain: string;
  fetchedAt: string;
  count: number;
  products: Product[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  mode: string;
  note: string;
};

function money(value: string, currency = "USD") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

export function ShopifyCatalogPreview() {
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (after: string | null = null) => {
    setLoading(true);
    setError(null);
    try {
      const query = after ? `?after=${encodeURIComponent(after)}` : "";
      const response = await fetch(`/api/admin/shopify/catalog${query}`, {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const body = await response.json() as CatalogResponse | { error?: string };
      if (!response.ok) {
        throw new Error("error" in body && body.error ? body.error : `Catalog request failed (HTTP ${response.status})`);
      }
      const result = body as CatalogResponse;
      setData(result);
      setCursor(after);
      setNextCursor(result.pageInfo.hasNextPage ? result.pageInfo.endCursor : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load Shopify catalog.");
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <section className="mt-8 space-y-5">
      <div className="dn-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-forest-muted">Connection mode</p>
          <p className="mt-1 font-semibold text-forest-ink">Read-only Shopify Admin API</p>
          <p className="mt-1 text-xs text-forest-muted">Credentials stay on the server. No Shopify token is sent to this browser.</p>
        </div>
        <button type="button" onClick={() => void load(null)} disabled={loading}
          className="rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {loading ? "Checking…" : data ? "Refresh catalog" : "Connect and inspect"}
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <strong>Catalog check failed.</strong> {error}
          <p className="mt-1 text-xs">Check the server-side Shopify credentials and Admin API permissions. Do not paste access tokens into this page.</p>
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["Shop", data.shopDomain],
              ["Products on page", data.count],
              ["Mode", data.mode.replaceAll("_", " ")],
              ["Last checked", new Date(data.fetchedAt).toLocaleString()],
            ].map(([label, value]) => (
              <div key={String(label)} className="dn-card min-w-0 p-4">
                <p className="text-xs uppercase tracking-wide text-forest-muted">{label}</p>
                <p className="mt-1 break-words text-sm font-semibold text-forest-ink">{String(value)}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <strong>Commerce is intentionally disabled.</strong> {data.note}
          </div>

          <div className="space-y-3">
            {data.products.map((product) => (
              <article key={product.externalProductId} className="dn-card min-w-0 overflow-hidden p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="break-words font-semibold text-forest-ink">{product.title}</h2>
                    <p className="mt-1 text-xs text-forest-muted">{product.vendor || "Supplier not identified"} · {product.productType || "Uncategorized"} · {product.status}</p>
                  </div>
                  <span className="rounded-full border border-amber-300 px-3 py-1 text-xs font-semibold text-amber-900">Not approved for sale</span>
                </div>
                {product.variantsMayBeIncomplete && (
                  <p className="mt-3 text-xs font-medium text-amber-800">Variant list is incomplete; additional variants must be fetched before review.</p>
                )}
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left text-xs">
                    <thead className="text-forest-muted">
                      <tr>
                        <th className="pb-2 pr-3 font-medium">Variant / SKU</th>
                        <th className="pb-2 pr-3 font-medium">Shopify listed price</th>
                        <th className="pb-2 pr-3 font-medium">Supplier unit cost</th>
                        <th className="pb-2 pr-3 font-medium">Observed stock</th>
                        <th className="pb-2 font-medium">Source verification</th>
                      </tr>
                    </thead>
                    <tbody>
                      {product.variants.map((variant) => (
                        <tr key={variant.externalVariantId} className="border-t border-card-border">
                          <td className="py-2 pr-3 text-forest-ink">{variant.title}<span className="block text-forest-muted">{variant.sku || "No SKU"}</span></td>
                          <td className="py-2 pr-3 text-forest-ink">{money(variant.supplierListedPrice)}</td>
                          <td className="py-2 pr-3 text-forest-ink">{variant.unitCost ? money(variant.unitCost.amount, variant.unitCost.currencyCode) : "Not provided"}</td>
                          <td className="py-2 pr-3 text-forest-ink">{variant.observedInventoryQuantity ?? "Unknown"}</td>
                          <td className="py-2 text-amber-800">Unverified</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => void load(null)} disabled={!cursor || loading}
              className="rounded-lg border border-card-border px-3 py-2 text-sm text-forest-ink disabled:opacity-40">First page</button>
            <button type="button" onClick={() => nextCursor && void load(nextCursor)} disabled={!nextCursor || loading}
              className="rounded-lg bg-forest px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Next page</button>
          </div>
        </>
      )}
    </section>
  );
}
