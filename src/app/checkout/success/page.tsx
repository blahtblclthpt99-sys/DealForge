import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Order received | DealForge",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const ORDER_NUMBER = /^DF-[A-Z0-9]+-[A-F0-9]{8}$/;
const ACCESS_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string | string[]; access?: string | string[] }>;
}) {
  const query = await searchParams;
  const order = typeof query.order === "string" && ORDER_NUMBER.test(query.order) ? query.order : "";
  const access = typeof query.access === "string" && ACCESS_TOKEN.test(query.access) ? query.access : "";
  const statusHref = order && access
    ? `/orders/${encodeURIComponent(order)}?access=${encodeURIComponent(access)}`
    : null;

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col justify-center px-6 py-16">
      <p className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Payment submitted</p>
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Thanks for your order.</h1>
      <p className="mt-4 text-base leading-7 text-zinc-600">DealForge confirms payment directly with Stripe before an order is released for sourcing or fulfillment. This page does not mark an order as paid.</p>
      <p className="mt-3 text-sm leading-6 text-zinc-500">If confirmation is still processing, your order remains pending until Stripe sends a verified payment event.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        {statusHref ? (
          <Link href={statusHref} className="rounded-xl bg-zinc-950 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800">View order status</Link>
        ) : (
          <Link href="/" className="rounded-xl bg-zinc-950 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800">Continue shopping</Link>
        )}
        <Link href="/dashboard" className="rounded-xl border border-zinc-300 px-5 py-3 text-sm font-semibold text-zinc-900 hover:bg-zinc-50">Go to dashboard</Link>
      </div>
      {order ? <p className="mt-5 text-xs text-zinc-500">Order reference: {order}</p> : null}
    </main>
  );
}
