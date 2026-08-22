"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { BellPlus, Search, Trash2 } from "lucide-react";

type ProductResult = {
  id: string;
  title: string;
  brand: string;
  price: number;
  retailer: string;
};

type MessageTone = "info" | "success" | "error";

function retailerName(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "amazon") return "Amazon";
  if (normalized === "ebay") return "eBay";
  if (normalized === "aliexpress") return "AliExpress";
  if (normalized === "walmart") return "Walmart";
  return value || "retailer";
}

export function PriceAlertForm() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductResult[]>([]);
  const [selected, setSelected] = useState<ProductResult | null>(null);
  const [targetPrice, setTargetPrice] = useState("");
  const [msg, setMsg] = useState("");
  const [msgTone, setMsgTone] = useState<MessageTone>("info");
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  function showMessage(message: string, tone: MessageTone = "info") {
    setMsg(message);
    setMsgTone(tone);
  }

  async function searchProducts(e: FormEvent) {
    e.preventDefault();
    const term = query.trim();
    if (!term) {
      setResults([]);
      showMessage("Enter a product name or brand to search.", "error");
      return;
    }

    setSearching(true);
    setMsg("");
    try {
      const res = await fetch(`/api/products?q=${encodeURIComponent(term)}&limit=8`, {
        headers: { Accept: "application/json" },
      });
      const body = (await res.json().catch(() => null)) as
        | { items?: ProductResult[]; error?: string }
        | null;
      if (!res.ok) {
        setResults([]);
        showMessage(body?.error || "Could not search products. Try again.", "error");
        return;
      }
      const items = Array.isArray(body?.items) ? body.items.slice(0, 8) : [];
      setResults(items);
      showMessage(items.length ? "Select a product from the results below." : "No matching available products found.", items.length ? "info" : "error");
    } catch {
      setResults([]);
      showMessage("Could not search products. Check your connection and try again.", "error");
    } finally {
      setSearching(false);
    }
  }

  function chooseProduct(product: ProductResult) {
    setSelected(product);
    setResults([]);
    setQuery(product.title);
    setTargetPrice(product.price > 0 ? product.price.toFixed(2) : "");
    showMessage(
      product.price > 0
        ? "Product selected. Choose the price you want to watch for."
        : `Product selected. ${retailerName(product.retailer)} must provide a verified current price before this alert can trigger.`,
      "info",
    );
  }

  async function saveAlert(e: FormEvent) {
    e.preventDefault();
    if (!selected) {
      showMessage("Search for and select a product first.", "error");
      return;
    }

    const target = Number(targetPrice);
    if (!Number.isFinite(target) || target <= 0) {
      showMessage("Enter a valid target price greater than $0.", "error");
      return;
    }

    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/price-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: selected.id, targetPrice: target }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        showMessage(body?.error || "Could not create the alert. Try again.", "error");
        return;
      }

      showMessage("Price alert saved.", "success");
      setSelected(null);
      setQuery("");
      setTargetPrice("");
      setResults([]);
      router.refresh();
    } catch {
      showMessage("Could not create the alert. Check your connection and try again.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dn-card overflow-hidden">
      <div className="border-b border-card-border p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-forest/9 text-forest">
            <BellPlus className="h-4 w-4" />
          </span>
          <div>
            <h2 className="font-display text-xl font-semibold text-forest-ink">Create a price alert</h2>
            <p className="mt-1 text-sm leading-6 text-forest-muted">Find a catalog product, choose your target, and DealForge will evaluate it only against a verified current price.</p>
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <form onSubmit={searchProducts} className="flex flex-col gap-2 sm:flex-row" aria-busy={searching}>
          <label className="sr-only" htmlFor="alert-product-search">Search products</label>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-forest-muted" />
            <input
              id="alert-product-search"
              type="search"
              autoComplete="off"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (selected && e.target.value !== selected.title) setSelected(null);
              }}
              placeholder="Search by product name or brand"
              className="dn-input pl-10"
            />
          </div>
          <button type="submit" disabled={searching} className="dn-button-secondary shrink-0">
            <Search className="h-4 w-4" /> {searching ? "Searching…" : "Find product"}
          </button>
        </form>

        {results.length > 0 ? (
          <div className="mt-4 max-h-80 space-y-2 overflow-y-auto rounded-xl border border-card-border bg-background/45 p-2" role="list" aria-label="Product search results">
            {results.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => chooseProduct(product)}
                className="w-full rounded-xl border border-transparent bg-card p-3.5 text-left transition hover:border-forest/30 hover:bg-forest/4"
              >
                <span className="block font-bold text-forest-ink">{product.title}</span>
                <span className="mt-1 block text-xs leading-5 text-forest-muted">
                  {product.brand || retailerName(product.retailer)} · {retailerName(product.retailer)}
                  {product.price > 0 ? ` · verified $${product.price.toFixed(2)}` : " · current price requires retailer check"}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {selected ? (
          <form onSubmit={saveAlert} className="mt-5 grid gap-4 rounded-xl border border-card-border bg-background/55 p-4 md:grid-cols-[minmax(0,1fr)_170px_auto] md:items-end" aria-busy={saving}>
            <div className="min-w-0">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-forest-muted">Selected product</p>
              <p className="mt-1.5 line-clamp-2 font-bold text-forest-ink">{selected.title}</p>
            </div>
            <div>
              <label htmlFor="alert-target-price" className="mb-2 block text-xs font-bold text-forest-muted">Target price</label>
              <input
                id="alert-target-price"
                required
                min="0.01"
                max="1000000"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                placeholder="0.00"
                className="dn-input"
              />
            </div>
            <button type="submit" disabled={saving} className="dn-button-primary shrink-0">
              <BellPlus className="h-4 w-4" /> {saving ? "Saving…" : "Add alert"}
            </button>
          </form>
        ) : null}

        {msg ? (
          <p className={`mt-4 ${msgTone === "success" ? "dn-status-success" : msgTone === "error" ? "dn-status-error" : "dn-status-info"}`} role="status" aria-live="polite">
            {msg}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function DeleteAlertButton({ id }: { id: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  return (
    <button
      type="button"
      disabled={deleting}
      onClick={async () => {
        setDeleting(true);
        try {
          const res = await fetch("/api/price-alerts", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
          });
          if (res.ok) router.refresh();
        } finally {
          setDeleting(false);
        }
      }}
      className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-card-border px-3.5 text-xs font-bold text-forest-muted transition hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-red-950/30"
    >
      <Trash2 className="h-3.5 w-3.5" /> {deleting ? "Removing…" : "Remove"}
    </button>
  );
}
