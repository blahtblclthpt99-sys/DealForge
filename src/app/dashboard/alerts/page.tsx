import Link from "next/link";
import { redirect } from "next/navigation";
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
    <div className="dn-container py-12">
      <Link href="/dashboard" className="text-sm text-forest hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-3 font-display text-3xl font-semibold text-forest-ink">Price alerts</h1>
      <p className="mt-2 max-w-2xl text-forest-muted">
        Alerts are evaluated only against retailer-verified current prices. Recorded or stale amounts are never treated as a live price.
      </p>

      <div className="mt-8">
        <PriceAlertForm />
      </div>

      <div className="mt-8 space-y-3">
        {alerts.map((alert) => {
          const product = products.get(alert.productId);
          return (
            <div key={alert.id} className="dn-card flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                {product ? (
                  <Link href={`/product/${product.slug}`} className="font-semibold text-forest-ink hover:text-forest">
                    {product.title}
                  </Link>
                ) : (
                  <p className="font-semibold text-forest-ink">Product unavailable</p>
                )}
                <p className="text-sm text-forest-muted">
                  Alert at {formatPrice(alert.targetPrice)}
                  {product
                    ? product.price > 0
                      ? ` · verified current price ${formatPrice(product.price)}`
                      : " · current retailer price needs verification"
                    : ""}
                </p>
              </div>
              <DeleteAlertButton id={alert.id} />
            </div>
          );
        })}
      </div>

      {alerts.length === 0 ? (
        <p className="mt-10 text-center text-forest-muted">No price alerts yet.</p>
      ) : null}
    </div>
  );
}
