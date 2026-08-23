import type { Metadata } from "next";
import { StripeCertificationClient } from "./stripe-certification-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Stripe Certification | DealForge",
  robots: { index: false, follow: false },
};

export default function StripeCertificationPage() {
  const isTestMode = (process.env.STRIPE_SECRET_KEY || "").trim().startsWith("sk_test_");

  return (
    <div className="dn-container py-16">
      <div className="mx-auto max-w-xl rounded-2xl border border-card-border bg-card p-7 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-forest">Internal certification</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-forest-ink">Stripe test checkout</h1>
        <p className="mt-3 text-sm leading-relaxed text-forest-muted">
          This private page exercises DealForge&apos;s real server-side checkout, Stripe Checkout, signed webhook,
          order payment ledger, and refund reconciliation path. It is excluded from the public catalog and search engines.
        </p>

        {isTestMode ? (
          <>
            <div className="mt-6 rounded-xl border border-card-border bg-forest/5 px-4 py-3 text-sm text-forest-ink">
              Stripe test mode is active. Charge amount: <strong>$0.75 USD</strong>.
            </div>
            <StripeCertificationClient />
          </>
        ) : (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            Certification checkout is disabled because this deployment is not using an sk_test_ Stripe secret key.
          </div>
        )}
      </div>
    </div>
  );
}
