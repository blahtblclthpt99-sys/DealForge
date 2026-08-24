"use client";

import { ExternalLink, LockKeyhole } from "lucide-react";
import { useState } from "react";

export function BuyButton({
  productId,
  purchaseMode = "affiliate",
  customerEmail = "",
  affiliateLabel = "View listing",
}: {
  productId: string;
  purchaseMode?: "direct" | "affiliate";
  customerEmail?: string;
  affiliateLabel?: string;
  retailer?: string;
  /** @deprecated Links are built live via /go/[productId] */
  affiliateUrl?: string;
}) {
  const [email, setEmail] = useState(customerEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (purchaseMode !== "direct") {
    return (
      <a
        href={`/go/${productId}`}
        target="_blank"
        rel="noopener noreferrer sponsored nofollow"
        className="inline-flex items-center gap-2 rounded-full bg-forest px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-forest-dark"
      >
        {affiliateLabel} <ExternalLink className="h-4 w-4" />
      </a>
    );
  }

  async function startCheckout() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setError("Enter a valid email for your order receipt.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const checkoutKey = `buy:${productId}:${crypto.randomUUID()}`;
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkoutKey,
          email: normalizedEmail,
          items: [{ productId, quantity: 1 }],
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || typeof payload.checkoutUrl !== "string") {
        const reason = typeof payload.error === "string" ? payload.error : "CHECKOUT_UNAVAILABLE";
        throw new Error(reason);
      }
      window.location.assign(payload.checkoutUrl);
    } catch (checkoutError) {
      const message = checkoutError instanceof Error ? checkoutError.message : "CHECKOUT_UNAVAILABLE";
      setError(
        message === "PRODUCT_COMMERCE_GATE_FAILED" || message === "COMMERCE_DISABLED"
          ? "This item is temporarily unavailable for DealForge checkout."
          : "Checkout is temporarily unavailable. Please try again.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="min-w-[16rem] max-w-sm">
      {!customerEmail ? (
        <label className="mb-2 block text-xs font-medium text-forest-muted">
          Receipt email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-forest-ink"
          />
        </label>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={startCheckout}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-forest px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-forest-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        <LockKeyhole className="h-4 w-4" /> {busy ? "Opening secure checkout…" : "Buy from DealForge"}
      </button>
      {error ? <p role="alert" className="mt-2 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
