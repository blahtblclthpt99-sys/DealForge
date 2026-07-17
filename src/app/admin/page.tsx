import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminPanels } from "@/components/admin-panels";
import { readSession } from "@/lib/auth";
import { cacheStatus } from "@/lib/cache";
import { listConnectors } from "@/lib/affiliate/registry";
import { prisma } from "@/lib/db";

export default async function AdminPage() {
  const session = await readSession();
  if (!session) redirect("/login?next=/admin");
  if (session.role !== "admin") redirect("/dashboard");

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
  ]);

  const views = viewSum._sum.viewCount || 0;
  const ctr = views > 0 ? Math.round((clickCount / views) * 1000) / 10 : 0;

  return (
    <div className="dn-container py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-forest">Admin</p>
          <h1 className="mt-1 font-display text-4xl font-semibold text-forest-ink">
            Operations dashboard
          </h1>
          <p className="mt-2 text-forest-muted">
            Affiliate stats, imports, cache, users, and product database controls.
          </p>
        </div>
        <Link href="/" className="text-sm text-forest hover:underline">
          View storefront
        </Link>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ["Products", productCount],
          ["Users", userCount],
          ["Clicks", clickCount],
          ["CTR %", ctr],
          ["Cache keys", cache.dbKeys + cache.memoryKeys],
        ].map(([label, value]) => (
          <div key={label as string} className="dn-card p-4">
            <p className="text-xs uppercase tracking-wide text-forest-muted">{label}</p>
            <p className="mt-1 text-2xl font-bold text-forest">{value as number}</p>
          </div>
        ))}
      </div>

      <AdminPanels
        providers={providers}
        connectors={listConnectors().map((c) => ({ id: c.id, displayName: c.displayName }))}
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
