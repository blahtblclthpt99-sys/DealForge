"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type ProductResult = {
  id: string;
  title: string;
  brand: string;
  price: number;
  retailer: string;
};

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
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  async function searchProducts(e: FormEvent) {
    e.preventDefault();
    const term = query.trim();
    if (!term) {
      setResults([]);
      setMsg("Enter a product name or brand to search.");
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
        setMsg(body?.error || "Could not search products. Try again.");
        return;
      }
      const items = Array.isArray(body?.items) ? body.items.slice(0, 8) : [];
      setResults(items);
      setMsg(items.length ? "" : "No matching available products found.");
    } catch {
      setResults([]);
      setMsg("Could not search products. Check your connection and try again.");
    } finally {
      setSearching(false);
    }
  }

  function chooseProduct(product: ProductResult) {
    setSelected(product);
    setResults([]);
    setQuery(product.title);
    setTargetPrice(product.price > 0 ? product.price.toFixed(2) : "");
    setMsg(
      product.price > 0
        ? "Product selected. Choose the price you want to watch for."
        : `Product selected. ${retailerName(product.retailer)} must provide a verified current price before this alert can trigger.`,
    );
  }

  async function saveAlert(e: FormEvent) {
    e.preventDefault();
    if (!selected) {
      setMsg("Search for and select a product first.");
      return;
    }

    const target = Number(targetPrice);
    if (!Number.isFinite(target) || target <= 0) {
      setMsg("Enter a valid target price greater than $0.");
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
        setMsg(body?.error || "Could not create the alert. Try again.");
        return;
      }

      setMsg("Price alert saved.");
      setSelected(null);
      setQuery("");
      setTargetPrice("");
      setResults([]);
      router.refresh();
    } catch {
      setMsg("Could not create the alert. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dn-card p-4 md:p-5">
      <form onSubmit={searchProducts} className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="alert-product-search">
          Search products
        </label>
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
          className="min-w-0 flex-1 rounded-xl border border-card-border bg-background px-3 py-2.5 text-sm"
        />
        <button
          type="submit"
          disabled={searching}
          className="rounded-full border border-forest/30 px-4 py-2.5 text-sm font-semibold text-forest transition hover:bg-forest/5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {searching ? "Searching…" : "Find product"}
        </button>
      </form>

      {results.length > 0 ? (
        <div className="mt-3 max-h-72 space-y-2 overflow-y-auto" role="list" aria-label="Product search results">
          {results.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => chooseProduct(product)}
              className="w-full rounded-xl border border-card-border bg-background p-3 text-left transition hover:border-forest/40"
            >
              <span className="block font-medium text-forest-ink">{product.title}</span>
              <span className="mt-1 block text-xs text-forest-muted">
                {product.brand || retailerName(product.retailer)} · {retailerName(product.retailer)}
                {product.price > 0 ? ` · verified $${product.price.toFixed(2)}` : " · current price requires retailer check"}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {selected ? (
        <form onSubmit={saveAlert} className="mt-4 grid gap-3 border-t border-card-border pt-4 md:grid-cols-[minmax(0,1fr)_160px_auto] md:items-end">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-forest-muted">Selected product</p>
            <p className="mt-1 truncate font-medium text-forest-ink">{selected.title}</p>
          </div>
          <div>
            <label htmlFor="alert-target-price" className="mb-1 block text-xs font-semibold text-forest-muted">
              Target price
            </label>
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
              placeholder="$0.00"
              className="w-full rounded-xl border border-card-border bg-background px-3 py-2.5 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-forest px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving…" : "Add alert"}
          </button>
        </form>
      ) : null}

      <p className="mt-3 min-h-4 text-xs text-forest-muted" role="status" aria-live="polite">
        {msg}
      </p>
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
      className="rounded-full border border-card-border px-3 py-1.5 text-xs text-forest-muted transition hover:border-red-300 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {deleting ? "Removing…" : "Remove"}
    </button>
  );
}
