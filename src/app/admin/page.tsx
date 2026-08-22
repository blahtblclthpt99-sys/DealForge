import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Boxes, Gauge, MousePointerClick, Users } from "lucide-react";
import { AdminPanels } from "@/components/admin-panels";
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
  const connectors = listConnectors().map((connector) => ({
    displayName: connector.displayName,
    ...affiliateRuntimeReadiness(connector.id),
  }));

  const metrics = [
    { label: "Products", value: productCount, icon: Boxes },
    { label: "Users", value: userCount, icon: Users },
    { label: "Clicks", value: clickCount, icon: MousePointerClick },
    { label: "CTR", value: `${ctr}%`, icon: Gauge },
    { label: "Cache keys", value: cache.dbKeys + cache.memoryKeys, icon: Gauge },
  ];

  return (
    <div className="dn-container py-10 sm:py-12 lg:py-14">
      <section className="dn-card overflow-hidden">
        <div className="flex flex-col gap-5 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--card)_98%,transparent),color-mix(in_srgb,var(--forest-primary)_6%,var(--card)))] p-5 sm:p-7 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-forest">DealForge operations</p>
            <h1 className="mt-2 font-display text-4xl font-semibold tracking-[-0.035em] text-forest-ink sm:text-5xl">Admin dashboard</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-forest-muted">
              Monitor catalog health, affiliate readiness, imports, cache state, users, and owner-only product intake from one operational workspace.
            </p>
          </div>
          <Link href="/" className="dn-button-secondary shrink-0">
            View storefront <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid grid-cols-2 border-t border-card-border md:grid-cols-5">
          {metrics.map((metric, index) => {
            const Icon = metric.icon;
            return (
              <div key={metric.label} className={`p-4 sm:p-5 ${index % 2 ? "border-l border-card-border" : ""} ${index >= 2 ? "border-t border-card-border md:border-t-0" : ""} ${index > 0 ? "md:border-l md:border-card-border" : ""}`}>
                <div className="flex items-center gap-2 text-forest-muted">
                  <Icon className="h-3.5 w-3.5" />
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.12em]">{metric.label}</p>
                </div>
                <p className="mt-2 text-2xl font-extrabold tracking-tight text-forest sm:text-3xl">{metric.value}</p>
              </div>
            );
          })}
        </div>
      </section>

      {ownerTools ? <OwnerProductIntake /> : null}

      <div className="mt-8">
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
    </div>
  );
}
