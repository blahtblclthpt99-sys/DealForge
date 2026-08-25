import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Clock3, Package, Truck } from "lucide-react";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { projectPublicShipment, publicFulfillmentStatus } from "@/lib/shipment-tracking";

function money(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function dateLabel(value: Date | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

function StatusIcon({ status }: { status: "processing" | "shipped" | "delivered" }) {
  if (status === "delivered") return <CheckCircle2 className="h-5 w-5" />;
  if (status === "shipped") return <Truck className="h-5 w-5" />;
  return <Clock3 className="h-5 w-5" />;
}

export default async function OrdersPage() {
  const session = await readSession();
  if (!session) redirect("/login?next=/dashboard/orders");

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, email: true },
  });
  if (!user || user.email.toLowerCase() !== session.email.toLowerCase()) redirect("/login");

  const orders = await prisma.order.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      orderNumber: true,
      status: true,
      currency: true,
      totalCents: true,
      paidAt: true,
      createdAt: true,
      items: {
        select: {
          id: true,
          productSlug: true,
          title: true,
          quantity: true,
          lineTotalCents: true,
          procurementIntent: {
            select: {
              status: true,
              events: {
                where: { type: { in: ["RECORD_SHIPMENT", "MARK_DELIVERED"] } },
                orderBy: { createdAt: "desc" },
                select: { type: true, detail: true, createdAt: true },
              },
            },
          },
        },
      },
    },
  });

  return (
    <div className="dn-container py-10 md:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-forest">Account</p>
          <h1 className="mt-1 font-display text-4xl font-semibold text-forest-ink">Your orders</h1>
          <p className="mt-2 text-forest-muted">Purchase history, fulfillment status, and shipment tracking.</p>
        </div>
        <Link href="/dashboard" className="dn-btn-secondary">Back to dashboard</Link>
      </div>

      {orders.length === 0 ? (
        <div className="dn-card mt-8 p-8 text-center">
          <Package className="mx-auto h-8 w-8 text-forest" />
          <h2 className="mt-3 text-lg font-semibold text-forest-ink">No orders yet</h2>
          <p className="mt-1 text-sm text-forest-muted">When you purchase from DealForge, your orders will appear here.</p>
          <Link href="/" className="dn-btn-primary mt-5 inline-flex">Browse deals</Link>
        </div>
      ) : (
        <div className="mt-8 space-y-5">
          {orders.map((order) => (
            <section key={order.orderNumber} className="dn-card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-forest/10 p-5">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-forest-muted">Order</p>
                  <h2 className="font-semibold text-forest-ink">{order.orderNumber}</h2>
                  <p className="mt-1 text-sm text-forest-muted">
                    {dateLabel(order.paidAt || order.createdAt)} · {order.status.replaceAll("_", " ")}
                  </p>
                </div>
                <p className="text-lg font-semibold text-forest-ink">{money(order.totalCents, order.currency)}</p>
              </div>

              <div className="divide-y divide-forest/10">
                {order.items.map((item) => {
                  const status = publicFulfillmentStatus(item.procurementIntent?.status || "processing");
                  const shipment = projectPublicShipment(item.procurementIntent?.events || []);
                  return (
                    <div key={item.id} className="grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-center">
                      <div>
                        <Link href={`/product/${item.productSlug}`} className="font-semibold text-forest-ink hover:text-forest">
                          {item.title}
                        </Link>
                        <p className="mt-1 text-sm text-forest-muted">
                          Qty {item.quantity} · {money(item.lineTotalCents, order.currency)}
                        </p>
                        {shipment ? (
                          <div className="mt-3 text-sm text-forest-muted">
                            <p>{shipment.carrierName} tracking: <span className="font-medium text-forest-ink">{shipment.trackingNumber}</span></p>
                            <p className="mt-1">
                              Shipped {dateLabel(new Date(shipment.shippedAt))}
                              {shipment.deliveredAt ? ` · Delivered ${dateLabel(new Date(shipment.deliveredAt))}` : ""}
                            </p>
                            {shipment.trackingUrl ? (
                              <a
                                href={shipment.trackingUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-2 inline-flex font-semibold text-forest hover:underline"
                              >
                                Track package
                              </a>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <div className="inline-flex w-fit items-center gap-2 rounded-full bg-forest/10 px-3 py-2 text-sm font-semibold capitalize text-forest">
                        <StatusIcon status={status} />
                        {status}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
