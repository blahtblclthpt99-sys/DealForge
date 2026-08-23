import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminPanels } from "@/components/admin-panels";
import { OwnerCommerceConsole } from "@/components/owner-commerce-console";
import { OwnerFulfillmentConsole } from "@/components/owner-fulfillment-console";
import { OwnerOpportunityQueue } from "@/components/owner-opportunity-queue";
import { OwnerProfitabilityPanel } from "@/components/owner-profitability-panel";
import { OwnerProductIntake } from "@/components/owner-product-intake";
import { readSession } from "@/lib/auth";
import { cacheStatus } from "@/lib/cache";
import { listConnectors } from "@/lib/affiliate/registry";
import { affiliateRuntimeReadiness } from "@/lib/affiliate/readiness";
import { prisma } from "@/lib/db";
import { isProductOwner } from "@/lib/owner-access";

export default async function AdminPage() {
  const session = await readSession();
  if (!session) redirect("/login?next=/admin");

  const currentUser = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, email: true, role: true },
  });
  if (!currentUser) redirect("/login?next=/admin");
  if (currentUser.role !== "admin") redirect("/dashboard");

  const ownerTools = await isProductOwner(currentUser);

  const [
    productCount,
    userCount,
    clickCount,
    providers,
    importJobs,
    errorLogs,
    apiUsage,
    users,
    products,
    cache,
    viewSum,
    liveCommerceCount,
    reviewedCommerceCount,
    paidOrderCount,
  ] = await Promise.all([
    prisma.product.count(),
    prisma.user.count(),
    prisma.clickEvent.count(),
    prisma.affiliateProvider.findMany({ orderBy: { provider: "asc" } }),
    prisma.importJob.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.systemLog.findMany({ orderBy: { createdAt: "desc" }, take: 15 }),
    prisma.apiUsageLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    }),
    prisma.product.findMany({
      orderBy: { lastUpdated: "desc" },
      take: 12,
      select: {
        id: true,
        title: true,
        price: true,
        originalPrice: true,
        isFeatured: true,
        isFlashDeal: true,
        availability: true,
        clickCount: true,
        asin: true,
      },
    }),
    cacheStatus(),
    prisma.product.aggregate({ _sum: { viewCount: true } }),
    ownerTools ? prisma.product.count({ where: { commerceEnabled: true } }) : Promise.resolve(0),
    ownerTools ? prisma.product.count({
      where: {
        commerceEnabled: false,
        specifications: { contains: '"status":"owner_reviewed_recommendation"' },
      },
    }) : Promise.resolve(0),
    ownerTools ? prisma.order.count({ where: { status: "paid" } }) : Promise.resolve(0),
  ]);

  const views = viewSum._sum.viewCount || 0;
  const ctr = views > 0 ? Math.round((clickCount / views) * 1000) / 10 : 0;
  const connectors = listConnectors().map((connector) => ({
    displayName: connector.displayName,
    ...affiliateRuntimeReadiness(connector.id),
  }));

  return (
    <div className="dn-container py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-forest">Admin</p>
          <h1 className="mt-1 font-display text-4xl font-semibold text-forest-ink">
            Operations dashboard
          </h1>
          <p className="mt-2 text-forest-muted">
            Commerce controls, profit opportunities, paid-order fulfillment, contribution analytics, catalog operations, imports, system health, users, and legacy provider readiness.
          </p>
        </div>
        <Link href="/" className="text-sm text-forest hover:underline">
          View storefront
        </Link>
      </div>

      <div className={`mt-8 grid grid-cols-2 gap-3 ${ownerTools ? "md:grid-cols-4 xl:grid-cols-8" : "md:grid-cols-5"}`}>
        {[
          ["Products", productCount],
          ["Users", userCount],
          ["Clicks", clickCount],
          ["CTR %", ctr],
          ["Cache keys", cache.dbKeys + cache.memoryKeys],
          ...(ownerTools ? [["Reviewed", reviewedCommerceCount], ["Direct live", liveCommerceCount], ["Paid orders", paidOrderCount]] : []),
        ].map(([label, value]) => (
          <div key={label as string} className="dn-card p-4">
            <p className="text-xs uppercase tracking-wide text-forest-muted">{label}</p>
            <p className="mt-1 text-2xl font-bold text-forest">{value as number}</p>
          </div>
        ))}
      </div>

      {ownerTools ? <OwnerCommerceConsole /> : null}
      {ownerTools ? <OwnerOpportunityQueue /> : null}
      {ownerTools ? <OwnerFulfillmentConsole /> : null}
      {ownerTools ? <OwnerProfitabilityPanel /> : null}
      {ownerTools ? <OwnerProductIntake /> : null}

      <AdminPanels
        providers={providers}
        connectors={connectors}
        importJobs={importJobs.map((j) => ({
          ...j,
          createdAt: j.createdAt.toISOString(),
          startedAt: j.startedAt?.toISOString() ?? null,
          finishedAt: j.finishedAt?.toISOString() ?? null,
        }))}
        logs={errorLogs.map((l) => ({
          ...l,
          createdAt: l.createdAt.toISOString(),
        }))}
        apiUsage={apiUsage.map((a) => ({
          ...a,
          createdAt: a.createdAt.toISOString(),
        }))}
        users={users.map((u) => ({
          ...u,
          createdAt: u.createdAt.toISOString(),
        }))}
        products={products}
        cache={cache}
      />
    </div>
  );
}
