"use client";

import { CreditCard } from "lucide-react";
import { useMemo, useState } from "react";

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function DirectBuyButton({
  productId,
  defaultEmail = "",
}: {
  productId: string;
  defaultEmail?: string;
}) {
  const [email, setEmail] = useState(defaultEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signedInEmail = useMemo(() => validEmail(defaultEmail), [defaultEmail]);

  async function startCheckout() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!validEmail(normalizedEmail)) {
      setError("Enter a valid email for your order receipt.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkoutKey: `buy:${crypto.randomUUID()}`,
          email: normalizedEmail,
          items: [{ productId, quantity: 1 }],
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || typeof result.checkoutUrl !== "string") {
        const code = typeof result.error === "string" ? result.error : "CHECKOUT_UNAVAILABLE";
        if (code === "PRODUCT_NOT_PURCHASABLE") {
          setError("This item is no longer available for DealForge checkout.");
        } else if (code === "ORDER_ALREADY_PAID") {
          setError("This checkout has already been completed.");
        } else {
          setError("Secure checkout is temporarily unavailable. Please try again.");
        }
        return;
      }
      window.location.assign(result.checkoutUrl);
    } catch {
      setError("Secure checkout is temporarily unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-[15rem] max-w-md">
      {!signedInEmail ? (
        <label className="mb-2 block text-xs font-semibold text-forest-ink">
          Receipt email
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
            placeholder="you@example.com"
            className="mt-1.5 min-h-11 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm text-forest-ink outline-none transition focus:border-forest focus:ring-2 focus:ring-forest/15"
          />
        </label>
      ) : null}
      <button
        type="button"
        onClick={startCheckout}
        disabled={busy}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-forest px-6 py-3 text-sm font-bold text-white shadow-md transition hover:-translate-y-0.5 hover:bg-forest-dark hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
      >
        <CreditCard className="h-4 w-4" />
        {busy ? "Opening secure checkout…" : "Buy from DealForge"}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
