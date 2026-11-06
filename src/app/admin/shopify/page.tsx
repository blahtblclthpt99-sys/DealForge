import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ShopifyCatalogPreview } from "@/components/shopify-catalog-preview";

export const dynamic = "force-dynamic";

export default async function ShopifyCatalogPage() {
  const session = await readSession();
  if (!session) redirect("/login?next=/admin/shopify");

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { email: true, role: true },
  });
  const ownerEmail = process.env.PRODUCT_ENGINE_OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail || !user || user.role !== "admin" || user.email.toLowerCase() !== ownerEmail) {
    redirect("/dashboard");
  }

  return (
    <main className="dn-container min-w-0 py-8 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-forest">Owner tools</p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-forest-ink sm:text-4xl">
            Shopify supplier catalog
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-forest-muted">
            Read-only supplier catalog inspection. This screen does not publish products, change inventory, place supplier orders, or enable checkout.
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link href="/admin" className="text-forest hover:underline">Admin dashboard</Link>
          <Link href="/admin/product-engine" className="text-forest hover:underline">Product Engine</Link>
        </div>
      </div>
      <ShopifyCatalogPreview />
    </main>
  );
}
