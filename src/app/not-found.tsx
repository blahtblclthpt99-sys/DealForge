import Link from "next/link";
import { ArrowRight, Home, Search } from "lucide-react";

export default function NotFound() {
  return (
    <div className="dn-container flex min-h-[58vh] items-center justify-center py-14 sm:py-18">
      <section className="dn-card w-full max-w-2xl overflow-hidden text-center">
        <div className="border-b border-card-border bg-[radial-gradient(circle_at_top,rgba(249,115,22,.12),transparent_55%)] p-7 sm:p-9">
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-forest">404 · DealForge</p>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-forest-ink sm:text-4xl">That page isn’t on the shelf</h1>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-forest-muted">
            The link may be outdated, the product may no longer be available, or the address may be incorrect. You can return to discovery without losing your account.
          </p>
        </div>
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:justify-center sm:p-6">
          <Link href="/search" className="dn-button-primary">
            <Search className="h-4 w-4" /> Find products <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/" className="dn-button-secondary">
            <Home className="h-4 w-4" /> Home
          </Link>
        </div>
      </section>
    </div>
  );
}
