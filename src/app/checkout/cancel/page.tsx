import Link from "next/link";

export default function CheckoutCancelPage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col justify-center px-6 py-16">
      <p className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-amber-700">Checkout canceled</p>
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">No payment was confirmed.</h1>
      <p className="mt-4 text-base leading-7 text-zinc-600">Your order will not be released for sourcing or fulfillment unless DealForge receives a verified successful payment event from Stripe.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/" className="rounded-xl bg-zinc-950 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800">Return to deals</Link>
        <Link href="/dashboard" className="rounded-xl border border-zinc-300 px-5 py-3 text-sm font-semibold text-zinc-900 hover:bg-zinc-50">Go to dashboard</Link>
      </div>
    </main>
  );
}
