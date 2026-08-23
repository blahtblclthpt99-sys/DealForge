"use client";

import { FormEvent, useState } from "react";

const CERTIFICATION_PRODUCT_ID = "cert_test_75c_20260822_v2";

type CheckoutResponse = {
  checkoutUrl?: string;
  orderNumber?: string;
  error?: string;
};

export function StripeCertificationClient() {
  const [email, setEmail] = useState("certification@example.com");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function startCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);

    try {
      const checkoutKey = `stripe-cert-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkoutKey,
          email,
          items: [{ productId: CERTIFICATION_PRODUCT_ID, quantity: 1 }],
        }),
      });
      const data = (await response.json()) as CheckoutResponse;

      if (!response.ok || !data.checkoutUrl) {
        throw new Error(data.error || "CHECKOUT_UNAVAILABLE");
      }

      window.location.assign(data.checkoutUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : "CHECKOUT_UNAVAILABLE";
      setStatus(message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={startCheckout} className="mt-8 space-y-5">
      <div>
        <label htmlFor="cert-email" className="mb-2 block text-sm font-medium text-forest-ink">
          Test receipt email
        </label>
        <input
          id="cert-email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-xl border border-card-border bg-card px-4 py-3 text-forest-ink outline-none focus:border-forest"
        />
      </div>

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-full bg-forest px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-forest-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Opening Stripe…" : "Start 75¢ Stripe Test Checkout"}
      </button>

      {status ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {status}
        </p>
      ) : null}
    </form>
  );
}
