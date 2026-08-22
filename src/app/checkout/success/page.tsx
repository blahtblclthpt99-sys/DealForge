import Link from "next/link";

export default function CheckoutSuccessPage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col justify-center px-6 py-16">
      <p className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Payment submitted</p>
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Thanks for your order.</h1>
      <p className="mt-4 text-base leading-7 text-zinc-600">DealForge confirms payment directly with Stripe before an order is released for sourcing or fulfillment. This page does not mark an order as paid.</p>
      <p className="mt-3 text-sm leading-6 text-zinc-500">If confirmation is still processing, your order remains pending until Stripe sends a verified payment event.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/" className="rounded-xl bg-zinc-950 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800">Continue shopping</Link>
        <Link href="/dashboard" className="rounded-xl border border-zinc-300 px-5 py-3 text-sm font-semibold text-zinc-900 hover:bg-zinc-50">Go to dashboard</Link>
      </div>
    </main>
  );
}
