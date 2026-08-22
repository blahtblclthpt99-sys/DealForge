"use client";

import Link from "next/link";
import { AlertTriangle, Home, RotateCcw, Search } from "lucide-react";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="dn-container flex min-h-[58vh] items-center justify-center py-14 sm:py-18">
      <section className="dn-card w-full max-w-2xl overflow-hidden text-center">
        <div className="border-b border-card-border bg-[radial-gradient(circle_at_top,rgba(249,115,22,.12),transparent_55%)] p-7 sm:p-9">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-forest/10 text-forest">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="mt-4 text-xs font-extrabold uppercase tracking-[0.14em] text-forest">DealForge</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-forest-ink sm:text-4xl">This page hit a problem</h1>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-forest-muted">
            The request could not be completed. Your account and saved DealForge data have not been intentionally changed by this screen.
          </p>
        </div>

        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:justify-center sm:p-6">
          <button type="button" onClick={reset} className="dn-button-primary">
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
          <Link href="/search" className="dn-button-secondary">
            <Search className="h-4 w-4" /> Find products
          </Link>
          <Link href="/" className="dn-button-secondary">
            <Home className="h-4 w-4" /> Home
          </Link>
        </div>
      </section>
    </div>
  );
}
