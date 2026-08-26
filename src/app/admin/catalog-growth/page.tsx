import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CatalogGrowthControls } from "@/components/catalog-growth-controls";

export const dynamic = "force-dynamic";

export default async function CatalogGrowthPage() {
  const session = await readSession();
  if (!session) redirect("/login?next=/admin/catalog-growth");

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { email: true, role: true },
  });
  const ownerEmail = process.env.PRODUCT_ENGINE_OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail || !user || user.role !== "admin" || user.email.toLowerCase() !== ownerEmail) {
    redirect("/dashboard");
  }

  return (
    <main className="dn-container py-8 sm:py-12">
      <div className="max-w-3xl">
        <p className="text-sm font-medium uppercase tracking-wide text-forest">Owner tools</p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-forest-ink sm:text-4xl">Catalog Growth</h1>
        <p className="mt-2 text-sm text-forest-muted">
          Expand DealForge through verified supplier feeds and profit-gated bundle candidates. New supplier rows remain quarantined until their commercial rights and source evidence are verified.
        </p>
      </div>
      <div className="mt-6">
        <CatalogGrowthControls />
      </div>
    </main>
  );
}
