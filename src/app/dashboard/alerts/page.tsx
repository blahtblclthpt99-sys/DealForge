import Link from "next/link";
import { redirect } from "next/navigation";
import { DeleteAlertButton } from "@/components/delete-alert-button";
import { PriceAlertForm } from "@/components/price-alert-form";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatPrice, parseJson } from "@/lib/utils";

type PriceAlert = {
  id: string;
  productId: string;
  targetPrice: number;
  createdAt: string;
};

export default async function AlertsPage() {
  const session = await readSession();
  if (!session) redirect("/login?next=/dashboard/alerts");
  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) redirect("/login");
  const alerts = parseJson<PriceAlert[]>(user.priceAlerts, []);
  const products = alerts.length
    ? await prisma.product.findMany({
        where: { id: { in: alerts.map((a) => a.productId) } },
        select: { id: true, title: true, price: true, slug: true },
      })
    : [];

  return (
    <div className="dn-container py-12">
      <Link href="/dashboard" className="text-sm text-forest hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-3 font-display text-3xl font-semibold text-forest-ink">Price alerts</h1>
      <p className="mt-2 text-forest-muted">
        We log alert hits in the background worker. Wire email/push in production.
      </p>

      <div className="mt-8">
        <PriceAlertForm />
      </div>

      <div className="mt-8 space-y-3">
        {alerts.map((a) => {
          const product = products.find((p) => p.id === a.productId);
          return (
            <div key={a.id} className="dn-card flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                {product ? (
                  <Link href={`/product/${product.slug}`} className="font-semibold text-forest-ink hover:text-forest">
                    {product.title}
                  </Link>
                ) : (
                  <p className="font-semibold text-forest-ink">Product unavailable</p>
                )}
                <p className="text-sm text-forest-muted">
                  Alert at {formatPrice(a.targetPrice)}
                  {product ? ` · now ${formatPrice(product.price)}` : ""}
                </p>
              </div>
              <DeleteAlertButton id={a.id} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
