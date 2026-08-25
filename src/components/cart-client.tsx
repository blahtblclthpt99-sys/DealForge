"use client";

import Link from "next/link";
import { Minus, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
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
  const [error, setError] = useState("");

  const refreshQuote = useCallback(async (nextItems: StoredCartItem[]) => {
    setItems(nextItems);
    setError("");
    if (nextItems.length === 0) {
      setQuote(null);
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
    void refreshQuote(readCart());
  }, [refreshQuote]);

  function setQuantity(productId: string, quantity: number) {
    updateCartQuantity(productId, quantity);
    void refreshQuote(readCart());
  }

  function remove(productId: string) {
    removeCartItem(productId);
    void refreshQuote(readCart());
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

          <button type="button" onClick={checkout} disabled={checkoutBusy || loading || !quote} className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-forest px-6 py-3 text-sm font-semibold text-white shadow-md hover:bg-forest-dark disabled:cursor-not-allowed disabled:opacity-50">
            {checkoutBusy ? "Revalidating…" : "Checkout"}
          </button>
          <p className="mt-3 text-center text-[11px] leading-relaxed text-forest-muted">No payment is taken until secure checkout. Supplier cost, availability, and minimum safe profit are revalidated before the payment session is created.</p>
        </aside>
      </div>
    </div>
  );
}
