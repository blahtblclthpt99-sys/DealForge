import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PackageCheck, RefreshCw, ShieldCheck, Truck } from "lucide-react";
import { readSession } from "@/lib/auth";
import { loadCustomerOrderStatus, type CustomerFinancialState } from "@/lib/customer-order-status";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Order status | DealForge",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const ORDER_NUMBER = /^DF-[A-Z0-9]+-[A-F0-9]{8}$/;
const ACCESS_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function financialLabel(state: CustomerFinancialState) {
  switch (state) {
    case "payment_pending": return "Payment confirmation pending";
    case "payment_failed": return "Payment was not completed";
    case "paid": return "Payment confirmed";
    case "partially_refunded": return "Partially refunded";
    case "refunded": return "Refunded";
    case "canceled": return "Canceled";
    default: return "Processing";
  }
}

function fulfillmentLabel(state: string | null) {
  switch (state) {
    case "awaiting_sourcing": return "Preparing to source";
    case "sourcing": return "Sourcing your order";
    case "supplier_ordered": return "Ordered from supplier";
    case "shipped": return "Shipped";
    case "delivered": return "Delivered";
    case "hold": return "Order needs attention";
    default: return "Not started";
  }
}

function statusMessage(financialState: CustomerFinancialState, fulfillmentState: string | null) {
  if (financialState === "payment_pending") return "DealForge will not release this order for sourcing until Stripe confirms the payment through a verified event.";
  if (financialState === "payment_failed") return "No fulfillment action is taken on a failed payment. You can return to the product page and start a new secure checkout.";
  if (financialState === "refunded") return "This order has been fully refunded. Any earlier fulfillment history is shown separately below.";
  if (financialState === "partially_refunded") return "A partial refund has been recorded. DealForge keeps payment and fulfillment status separate so both remain accurate.";
  if (fulfillmentState === "delivered") return "The order is recorded as delivered.";
  if (fulfillmentState === "shipped") return "Your order has shipped. Tracking information is shown below when available.";
  if (fulfillmentState === "supplier_ordered") return "The supplier order has been recorded and DealForge is waiting for shipment details.";
  if (fulfillmentState === "sourcing") return "DealForge is sourcing the paid order from the reviewed supplier.";
  if (fulfillmentState === "hold") return "This order is on an internal fulfillment hold while DealForge resolves an issue.";
  return "Payment is confirmed and the order is queued for sourcing.";
}

export default async function OrderStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ access?: string | string[] }>;
}) {
  const [{ orderNumber }, query, session] = await Promise.all([params, searchParams, readSession()]);
  const access = typeof query.access === "string" ? query.access : "";
  if (!ORDER_NUMBER.test(orderNumber) || (access && !ACCESS_TOKEN.test(access))) notFound();

  const order = await loadCustomerOrderStatus({
    orderNumber,
    accessToken: access || null,
    sessionUserId: session?.id || null,
  });
  if (!order) notFound();

  const refreshHref = access
    ? `/orders/${encodeURIComponent(order.orderNumber)}?access=${encodeURIComponent(access)}`
    : `/orders/${encodeURIComponent(order.orderNumber)}`;

  return (
    <main className="dn-container py-10 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-forest">DealForge order</p>
            <h1 className="mt-1 font-display text-3xl font-semibold text-forest-ink sm:text-4xl">{order.orderNumber}</h1>
            <p className="mt-2 text-sm text-forest-muted">Last updated {new Date(order.lastUpdatedAt).toLocaleString()}</p>
          </div>
          <a href={refreshHref} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-card-border bg-background px-4 py-2 text-sm font-bold text-forest">
            <RefreshCw className="h-4 w-4" /> Refresh status
          </a>
        </div>

        <section className="dn-card mt-6 p-5 sm:p-6" aria-labelledby="order-progress">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-forest-muted">Financial status</p>
              <h2 id="order-progress" className="mt-1 text-xl font-bold text-forest-ink">{financialLabel(order.financialState)}</h2>
            </div>
            <div className="rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
              <ShieldCheck className="mr-1 inline h-4 w-4" /> Server verified
            </div>
          </div>
          <div className="mt-5 rounded-2xl border border-card-border bg-background p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-forest-muted">Fulfillment</p>
            <p className="mt-1 text-lg font-semibold text-forest-ink">{fulfillmentLabel(order.fulfillmentState)}</p>
            <p className="mt-2 text-sm leading-6 text-forest-muted">{statusMessage(order.financialState, order.fulfillmentState)}</p>
          </div>
        </section>

        {order.tracking ? (
          <section className="dn-card mt-4 p-5" aria-labelledby="tracking-heading">
            <div className="flex items-center gap-2 text-forest"><Truck className="h-5 w-5" /><h2 id="tracking-heading" className="font-bold">Tracking</h2></div>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-forest-muted">Carrier</dt><dd className="mt-1 font-semibold text-forest-ink">{order.tracking.carrier}</dd></div>
              <div><dt className="text-forest-muted">Tracking number</dt><dd className="mt-1 break-all font-mono font-semibold text-forest-ink">{order.tracking.trackingNumber}</dd></div>
            </dl>
          </section>
        ) : null}

        <section className="dn-card mt-4 p-5 sm:p-6" aria-labelledby="order-items">
          <h2 id="order-items" className="flex items-center gap-2 text-lg font-bold text-forest-ink"><PackageCheck className="h-5 w-5 text-forest" /> Order summary</h2>
          <div className="mt-4 divide-y divide-card-border">
            {order.items.map((item, index) => (
              <div key={`${item.title}-${index}`} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div><p className="font-medium text-forest-ink">{item.title}</p><p className="mt-1 text-xs text-forest-muted">Quantity {item.quantity} · {money(item.unitPriceCents, order.currency)} each</p></div>
                <p className="shrink-0 font-semibold text-forest-ink">{money(item.lineTotalCents, order.currency)}</p>
              </div>
            ))}
          </div>
          <dl className="mt-5 space-y-2 border-t border-card-border pt-4 text-sm">
            <div className="flex justify-between"><dt className="text-forest-muted">Subtotal</dt><dd>{money(order.subtotalCents, order.currency)}</dd></div>
            {order.shippingCents ? <div className="flex justify-between"><dt className="text-forest-muted">Shipping</dt><dd>{money(order.shippingCents, order.currency)}</dd></div> : null}
            {order.taxCents ? <div className="flex justify-between"><dt className="text-forest-muted">Tax</dt><dd>{money(order.taxCents, order.currency)}</dd></div> : null}
            <div className="flex justify-between text-base font-bold text-forest-ink"><dt>Total</dt><dd>{money(order.totalCents, order.currency)}</dd></div>
            {order.refundedCents ? <div className="flex justify-between font-semibold text-amber-700 dark:text-amber-300"><dt>Refunded</dt><dd>{money(order.refundedCents, order.currency)}</dd></div> : null}
          </dl>
        </section>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/" className="rounded-xl bg-forest px-5 py-3 text-sm font-bold text-white">Continue shopping</Link>
          <Link href="/dashboard" className="rounded-xl border border-card-border px-5 py-3 text-sm font-bold text-forest">Account dashboard</Link>
        </div>
        <p className="mt-6 text-xs leading-5 text-forest-muted">This customer view intentionally omits supplier purchase references, supplier costs, DealForge margin data, internal notes, and administrative identifiers.</p>
      </div>
    </main>
  );
}
