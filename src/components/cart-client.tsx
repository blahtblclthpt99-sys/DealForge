"use client";

import Link from "next/link";
import { Minus, PackagePlus, Plus, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  addCartItem,
  readCart,
  removeCartItem,
  type StoredCartItem,
  updateCartQuantity,
} from "@/lib/cart-client";

type QuoteItem = {
  productId: string;
  slug: string;
  title: string;
  quantity: number;
  currency: string;
  publishedUnitPriceCents: number;
  unitPriceCents: number;
  lineTotalCents: number;
  savingsCents: number;
  savingsPercent: number;
};

type CartQuote = {
  currency: string;
  subtotalCents: number;
  publishedSubtotalCents: number;
  savingsCents: number;
  quotedAt: string;
  items: QuoteItem[];
};

type AddonItem = {
  productId: string;
  slug: string;
  title: string;
  brand: string;
  currency: string;
  unitPriceCents: number;
  publishedUnitPriceCents: number;
  savingsCents: number;
  fitLabel: string;
};

function money(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

export function CartClient({ initialEmail = "" }: { initialEmail?: string }) {
  const [items, setItems] = useState<StoredCartItem[]>([]);
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [email, setEmail] = useState(initialEmail);
  const [loading, setLoading] = useState(true);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [addonsBusy, setAddonsBusy] = useState(false);
  const [addonsSearched, setAddonsSearched] = useState(false);
  const [addons, setAddons] = useState<AddonItem[]>([]);
  const [error, setError] = useState("");

  const refreshQuote = useCallback(async (nextItems: StoredCartItem[]) => {
    setItems(nextItems);
    setError("");
    if (nextItems.length === 0) {
      setQuote(null);
      setAddons([]);
      setAddonsSearched(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/cart/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: nextItems }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(payload.items)) {
        const reason = typeof payload.error === "string" ? payload.error : "CART_QUOTE_UNAVAILABLE";
        throw new Error(reason);
      }
      setQuote(payload as CartQuote);
    } catch (quoteError) {
      setQuote(null);
      const reason = quoteError instanceof Error ? quoteError.message : "CART_QUOTE_UNAVAILABLE";
      setError(
        reason === "PUBLISHED_PRICE_NO_LONGER_SAFE" ||
        reason === "MINIMUM_SAFE_PROFIT_NOT_MET" ||
        reason === "PRODUCT_COMMERCE_GATE_FAILED" ||
        reason === "PRODUCT_SUPPLIER_BINDING_FAILED"
          ? "One or more items can no longer be sold safely at the displayed price. Remove the affected item or try again after pricing refreshes."
          : "We could not confirm the current cart price. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshQuote(readCart());
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshQuote]);

  function invalidateAddons() {
    setAddons([]);
    setAddonsSearched(false);
  }

  function setQuantity(productId: string, quantity: number) {
    updateCartQuantity(productId, quantity);
    invalidateAddons();
    void refreshQuote(readCart());
  }

  function remove(productId: string) {
    removeCartItem(productId);
    invalidateAddons();
    void refreshQuote(readCart());
  }

  async function findCheapAddons() {
    if (items.length === 0 || !quote) return;
    setAddonsBusy(true);
    setAddonsSearched(false);
    setError("");
    try {
      const response = await fetch("/api/cart/addons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(payload.items)) {
        throw new Error(typeof payload.error === "string" ? payload.error : "ADDON_SEARCH_UNAVAILABLE");
      }
      setAddons(payload.items as AddonItem[]);
      setAddonsSearched(true);
    } catch {
      setAddons([]);
      setAddonsSearched(false);
      setError("We could not search for safe bundle add-ons right now. Your current cart is unchanged.");
    } finally {
      setAddonsBusy(false);
    }
  }

  async function addAddon(productId: string) {
    addCartItem(productId, 1);
    setAddons((current) => current.filter((item) => item.productId !== productId));
    await refreshQuote(readCart());
  }

  async function checkout() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setError("Enter a valid email for your order receipt.");
      return;
    }
    if (!quote || items.length === 0) {
      setError("Your cart needs a confirmed price before checkout.");
      return;
    }

    setCheckoutBusy(true);
    setError("");
    try {
      // Checkout repeats the exact server-side pricing and supplier validation.
      // The cart quote is never trusted as payment authority.
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkoutKey: `cart:${crypto.randomUUID()}`,
          email: normalizedEmail,
          items,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || typeof payload.checkoutUrl !== "string") {
        const reason = typeof payload.error === "string" ? payload.error : "CHECKOUT_UNAVAILABLE";
        if (reason === "ORDER_PRICE_CHANGED_RESTART_CHECKOUT" || reason === "PRODUCT_PRICE_NO_LONGER_SAFE") {
          await refreshQuote(readCart());
          throw new Error("CART_PRICE_CHANGED");
        }
        throw new Error(reason);
      }
      window.location.assign(payload.checkoutUrl);
    } catch (checkoutError) {
      const reason = checkoutError instanceof Error ? checkoutError.message : "CHECKOUT_UNAVAILABLE";
      setError(
        reason === "CART_PRICE_CHANGED"
          ? "The price changed before payment. Your cart has been refreshed; review the confirmed price and checkout again."
          : "Secure checkout is temporarily unavailable. Your cart has been kept intact.",
      );
      setCheckoutBusy(false);
    }
  }

  if (!loading && items.length === 0) {
    return (
      <div className="dn-card mx-auto max-w-2xl p-8 text-center">
        <h1 className="font-display text-3xl font-semibold text-forest-ink">Your cart is empty</h1>
        <p className="mt-3 text-sm text-forest-muted">Add a product and DealForge will calculate its lowest safe customer price when it enters the cart.</p>
        <Link href="/deals" className="mt-6 inline-flex rounded-full bg-forest px-6 py-3 text-sm font-semibold text-white hover:bg-forest-dark">Browse deals</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-forest">Cart price confirmation</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-forest-ink md:text-4xl">Your DealForge cart</h1>
        <p className="mt-2 max-w-2xl text-sm text-forest-muted">The price shown here is recalculated from verified product economics when the item enters your cart. Checkout validates it once more before payment.</p>
      </div>

      {error ? <div role="alert" className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          <section className="space-y-3" aria-label="Cart items">
            {loading && !quote ? <div className="dn-card p-6 text-sm text-forest-muted">Confirming your lowest safe cart price…</div> : null}
            {quote?.items.map((item) => (
              <article key={item.productId} className="dn-card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Link href={`/product/${item.slug}`} className="font-display text-lg font-semibold text-forest-ink hover:text-forest">{item.title}</Link>
                    <div className="mt-3 flex flex-wrap items-baseline gap-2">
                      <span className="text-2xl font-bold text-forest">{money(item.unitPriceCents, item.currency)}</span>
                      {item.savingsCents > 0 ? <span className="text-sm text-forest-muted line-through">{money(item.publishedUnitPriceCents, item.currency)}</span> : null}
                      {item.savingsCents > 0 ? <span className="rounded-full bg-forest/10 px-2 py-1 text-xs font-semibold text-forest">Cart saves {money(item.savingsCents / item.quantity, item.currency)}</span> : null}
                    </div>
                    <p className="mt-1 text-xs text-forest-muted">Confirmed DealForge cart price</p>
                  </div>
                  <button type="button" onClick={() => remove(item.productId)} aria-label={`Remove ${item.title}`} className="rounded-full border border-card-border p-2 text-forest-muted hover:text-red-700"><Trash2 className="h-4 w-4" /></button>
                </div>

                <div className="mt-5 flex items-center justify-between gap-4 border-t border-card-border pt-4">
                  <div className="inline-flex items-center rounded-full border border-card-border">
                    <button type="button" onClick={() => setQuantity(item.productId, item.quantity - 1)} aria-label="Decrease quantity" className="p-2 text-forest-muted hover:text-forest"><Minus className="h-4 w-4" /></button>
                    <span className="min-w-10 text-center text-sm font-semibold text-forest-ink">{item.quantity}</span>
                    <button type="button" onClick={() => setQuantity(item.productId, item.quantity + 1)} disabled={item.quantity >= 25} aria-label="Increase quantity" className="p-2 text-forest-muted hover:text-forest disabled:opacity-40"><Plus className="h-4 w-4" /></button>
                  </div>
                  <span className="font-semibold text-forest-ink">{money(item.lineTotalCents, item.currency)}</span>
                </div>
              </article>
            ))}
          </section>

          {addonsSearched ? (
            <section className="dn-card mt-5 p-5" aria-label="Cheap bundle add-ons">
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-forest/10 p-2 text-forest"><PackagePlus className="h-5 w-5" /></div>
                <div>
                  <h2 className="font-display text-xl font-semibold text-forest-ink">Build a bundle</h2>
                  <p className="mt-1 text-sm text-forest-muted">Low-cost add-ons related to what is already in your cart. Every suggestion passed the same DealForge pricing and supplier checks before being shown.</p>
                </div>
              </div>

              {addons.length > 0 ? (
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {addons.map((addon) => (
                    <article key={addon.productId} className="rounded-2xl border border-card-border bg-background p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-forest">{addon.fitLabel}</p>
                      <Link href={`/product/${addon.slug}`} className="mt-1 line-clamp-2 text-sm font-semibold text-forest-ink hover:text-forest">{addon.title}</Link>
                      <p className="mt-1 text-xs text-forest-muted">{addon.brand}</p>
                      <div className="mt-3 flex items-end justify-between gap-3">
                        <div>
                          <p className="text-lg font-bold text-forest">{money(addon.unitPriceCents, addon.currency)}</p>
                          {addon.savingsCents > 0 ? <p className="text-[11px] text-forest-muted">Bundle add-on saves {money(addon.savingsCents, addon.currency)}</p> : <p className="text-[11px] text-forest-muted">Safe add-on price</p>}
                        </div>
                        <button type="button" onClick={() => void addAddon(addon.productId)} className="rounded-full bg-forest px-3 py-2 text-xs font-semibold text-white hover:bg-forest-dark">Add</button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="mt-5 rounded-xl bg-forest/5 p-4 text-sm text-forest-muted">No cheap add-ons currently meet both the compatibility and safe-price rules for this cart.</p>
              )}
            </section>
          ) : null}
        </div>

        <aside className="dn-card h-fit p-6 lg:sticky lg:top-24">
          <div className="flex items-center gap-2 text-sm font-semibold text-forest"><ShieldCheck className="h-4 w-4" /> Server-confirmed pricing</div>
          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-forest-muted">Published total</dt><dd className={quote && quote.savingsCents > 0 ? "text-forest-muted line-through" : "font-medium text-forest-ink"}>{quote ? money(quote.publishedSubtotalCents, quote.currency) : "—"}</dd></div>
            {quote && quote.savingsCents > 0 ? <div className="flex justify-between gap-4"><dt className="font-medium text-forest">Cart savings</dt><dd className="font-semibold text-forest">−{money(quote.savingsCents, quote.currency)}</dd></div> : null}
            <div className="flex justify-between gap-4 border-t border-card-border pt-4 text-base"><dt className="font-semibold text-forest-ink">Cart total</dt><dd className="text-xl font-bold text-forest">{quote ? money(quote.subtotalCents, quote.currency) : "—"}</dd></div>
          </dl>

          <label className="mt-6 block text-xs font-medium text-forest-muted">
            Receipt email
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2.5 text-sm text-forest-ink outline-none ring-forest focus:ring-2" />
          </label>

          <button type="button" onClick={findCheapAddons} disabled={addonsBusy || loading || !quote} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full border border-forest bg-background px-5 py-3 text-sm font-semibold text-forest transition hover:bg-forest/5 disabled:cursor-not-allowed disabled:opacity-50">
            <Sparkles className="h-4 w-4" /> {addonsBusy ? "Searching safe add-ons…" : addonsSearched ? "Search cheap add-ons again" : "Find cheap add-ons"}
          </button>
          <p className="mt-2 text-center text-[11px] leading-relaxed text-forest-muted">Optional: find low-cost related items to turn this order into a bundle before checkout.</p>

          <button type="button" onClick={checkout} disabled={checkoutBusy || loading || !quote} className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-forest px-6 py-3 text-sm font-semibold text-white shadow-md hover:bg-forest-dark disabled:cursor-not-allowed disabled:opacity-50">
            {checkoutBusy ? "Revalidating…" : "Checkout"}
          </button>
          <p className="mt-3 text-center text-[11px] leading-relaxed text-forest-muted">No payment is taken until secure checkout. Supplier cost, availability, and minimum safe profit are revalidated before the payment session is created.</p>
        </aside>
      </div>
    </div>
  );
}
