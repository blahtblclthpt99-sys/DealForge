import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Bell, Search, ShieldCheck } from "lucide-react";
import { DeleteAlertButton } from "@/components/delete-alert-button";
import { PriceAlertForm } from "@/components/price-alert-form";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicProductWhere } from "@/lib/product-visibility";
import { toProductDTO } from "@/lib/products";
import { formatPrice, parseJson } from "@/lib/utils";

type PriceAlert = {
  id: string;
  productId: string;
  targetPrice: number;
  createdAt: string;
};

function cleanAlerts(value: unknown): PriceAlert[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (alert): alert is PriceAlert =>
        Boolean(alert) &&
        typeof alert === "object" &&
        typeof (alert as PriceAlert).id === "string" &&
        typeof (alert as PriceAlert).productId === "string" &&
        Number.isFinite((alert as PriceAlert).targetPrice) &&
        (alert as PriceAlert).targetPrice > 0 &&
        typeof (alert as PriceAlert).createdAt === "string",
    )
    .slice(0, 50);
}

export default async function AlertsPage() {
  const session = await readSession();
  if (!session) redirect("/login?next=/dashboard/alerts");
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { priceAlerts: true },
  });
  if (!user) redirect("/login");

  const alerts = cleanAlerts(parseJson<unknown>(user.priceAlerts, []));
  const productRows = alerts.length
    ? await prisma.product.findMany({
        where: publicProductWhere({ id: { in: alerts.map((alert) => alert.productId) } }),
        include: { category: true },
      })
    : [];
  const products = new Map(productRows.map((row) => [row.id, toProductDTO(row)]));

  return (
    <div className="dn-container py-10 sm:py-12 lg:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/dashboard" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-bold text-forest hover:underline">
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>
          <p className="mt-4 text-xs font-extrabold uppercase tracking-[0.14em] text-forest">Price tracking</p>
          <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight text-forest-ink sm:text-5xl">Price alerts</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-forest-muted">
            Alerts are evaluated only against retailer-verified current prices. Recorded or stale amounts are never treated as a live price.
          </p>
        </div>
        <Link href="/search" className="dn-button-secondary">
          <Search className="h-4 w-4" /> Find products
        </Link>
      </div>

      <div className="mt-7 inline-flex items-start gap-2 rounded-xl border border-card-border bg-card px-3.5 py-3 text-xs leading-5 text-forest-muted shadow-sm">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-forest" />
        <span>The retailer remains the source of truth for final price and availability.</span>
      </div>

      <div className="mt-7">
        <PriceAlertForm />
      </div>

      {alerts.length > 0 ? (
        <section className="mt-9">
          <div className="mb-4">
            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-forest">Active alerts</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-forest-ink">{alerts.length.toLocaleString()} {alerts.length === 1 ? "product" : "products"} being watched</h2>
          </div>
          <div className="grid gap-3">
            {alerts.map((alert) => {
              const product = products.get(alert.productId);
              return (
                <article key={alert.id} className="dn-card flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                  <div className="min-w-0">
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-forest-muted">Target {formatPrice(alert.targetPrice)}</p>
                    {product ? (
                      <Link href={`/product/${product.slug}`} className="mt-1.5 block truncate font-extrabold text-forest-ink hover:text-forest">
                        {product.title}
                      </Link>
                    ) : (
                      <p className="mt-1.5 font-extrabold text-forest-ink">Product unavailable</p>
                    )}
                    <p className="mt-1 text-xs leading-5 text-forest-muted">
                      {product
                        ? product.price > 0
                          ? `Verified current price ${formatPrice(product.price)}`
                          : "Current retailer price needs verification before this alert can trigger."
                        : "This catalog item is no longer available to display."}
                    </p>
                  </div>
                  <DeleteAlertButton id={alert.id} />
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="dn-card mt-9 px-5 py-12 text-center sm:py-14">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-forest/9 text-forest">
            <Bell className="h-5 w-5" />
          </span>
          <h2 className="mt-4 font-display text-2xl font-semibold text-forest-ink">No price alerts yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-forest-muted">Search above for a product and choose the price you want DealForge to watch for.</p>
        </section>
      )}
    </div>
  );
}
