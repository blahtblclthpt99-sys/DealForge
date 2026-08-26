import Link from "next/link";
import { redirect } from "next/navigation";
import { ProcurementIntegrityConsole } from "@/components/procurement-integrity-console";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ProcurementIntegrityPage() {
  const session = await readSession();
  if (!session) redirect("/login?next=/admin/procurement");

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
            Procurement integrity
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-forest-muted">
            Inspect quarantined manual supplier purchases against immutable execution evidence and clear only fully reconciled integrity blockers through an explicit audited owner action.
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link href="/admin/product-engine" className="text-forest hover:underline">
            Product Engine
          </Link>
          <Link href="/admin" className="text-forest hover:underline">
            Admin dashboard
          </Link>
        </div>
      </div>

      <ProcurementIntegrityConsole />
    </main>
  );
}
