import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  COMMERCE_QUARANTINE_ACTIONS,
  COMMERCE_QUARANTINE_RESOLUTION_ACTION,
} from "@/lib/commerce-quarantine";
import { calculateQuarantinePerformanceAnalytics } from "@/lib/commerce-quarantine-analytics";

function reasonLabel(reason: string) {
  return reason.replaceAll("_", " ");
}

function formatDuration(ms: number | null) {
  if (ms === null) return "n/a";
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hr`;
  return `${Math.round(hours / 24)} days`;
}

function trendLabel(delta: number | null) {
  if (delta === null) return "no comparable activity";
  if (delta === 0) return "flat vs prior 7d";
  return `${delta > 0 ? "+" : ""}${delta}% vs prior 7d`;
}

export async function CommerceQuarantinePerformanceIntelligence() {
  const audits = await prisma.productEngineAudit.findMany({
    where: { action: { in: [...COMMERCE_QUARANTINE_ACTIONS, COMMERCE_QUARANTINE_RESOLUTION_ACTION] } },
    orderBy: { createdAt: "desc" },
    take: 2000,
    select: { id: true, action: true, detail: true, createdAt: true },
  });
  const analytics = calculateQuarantinePerformanceAnalytics(audits, new Date());
  const topProducts = analytics.products.filter((product) => product.events > 1).slice(0, 8);
  const productIds = topProducts.map((product) => product.productId);
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, title: true, slug: true },
      })
    : [];
  const productById = new Map(products.map((product) => [product.id, product]));
  const topReasons = analytics.reasons.slice(0, 8);

  return (
    <section id="quarantine-performance" className="dn-card mt-6 min-w-0 scroll-mt-6 overflow-hidden p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-forest-ink">Quarantine performance intelligence</h2>
          <p className="mt-1 max-w-3xl text-sm text-forest-muted">
            Read-only operational history from the latest 2,000 quarantine and resolution audit rows. Use it to improve upstream evidence quality, not to bypass product safety gates.
          </p>
        </div>
        <span className="rounded-full border border-card-border px-3 py-1 text-xs font-semibold text-forest-muted">{analytics.totalEvents} quarantine event(s)</span>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-2xl border border-card-border p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-forest-muted">Recovery rate</p>
          <p className="mt-1 text-2xl font-semibold text-forest-ink">{analytics.recoveryRatePct === null ? "n/a" : `${analytics.recoveryRatePct}%`}</p>
          <p className="mt-1 text-xs text-forest-muted">{analytics.resolvedEvents} resolved · {analytics.openEvents} open</p>
        </div>
        <div className="rounded-2xl border border-card-border p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-forest-muted">Median recovery</p>
          <p className="mt-1 text-2xl font-semibold text-forest-ink">{formatDuration(analytics.medianResolvedDurationMs)}</p>
          <p className="mt-1 text-xs text-forest-muted">Resolved episodes only.</p>
        </div>
        <div className="rounded-2xl border border-card-border p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-forest-muted">Recent 7d</p>
          <p className="mt-1 text-2xl font-semibold text-forest-ink">{analytics.recent7dEvents}</p>
          <p className="mt-1 text-xs text-forest-muted">{trendLabel(analytics.sevenDayDeltaPct)}</p>
        </div>
        <div className="rounded-2xl border border-card-border p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-forest-muted">Repeat products</p>
          <p className="mt-1 text-2xl font-semibold text-forest-ink">{analytics.repeatProductCount}</p>
          <p className="mt-1 text-xs text-forest-muted">More than one quarantine event.</p>
        </div>
        <div className="rounded-2xl border border-card-border p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-forest-muted">Prior 7d</p>
          <p className="mt-1 text-2xl font-semibold text-forest-ink">{analytics.prior7dEvents}</p>
          <p className="mt-1 text-xs text-forest-muted">Comparison window.</p>
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-2">
        <div className="rounded-2xl border border-card-border p-4">
          <h3 className="font-display text-lg font-semibold text-forest-ink">Evidence types causing downtime</h3>
          <p className="mt-1 text-xs text-forest-muted">Ranked by quarantine-event frequency. Median downtime is based only on resolved episodes carrying that reason.</p>
          {topReasons.length ? (
            <div className="mt-4 space-y-3">
              {topReasons.map((reason) => (
                <div key={reason.reason} className="rounded-xl border border-card-border p-3">
                  <p className="break-words text-sm font-semibold text-forest-ink">{reasonLabel(reason.reason)}</p>
                  <p className="mt-1 text-xs text-forest-muted">
                    {reason.events} event(s) · {reason.open} open · {reason.resolved} resolved · median recovery {formatDuration(reason.medianResolvedDurationMs)}
                  </p>
                </div>
              ))}
            </div>
          ) : <p className="mt-3 text-sm text-forest-muted">No quarantine history is available in the audit window.</p>}
        </div>

        <div className="rounded-2xl border border-card-border p-4">
          <h3 className="font-display text-lg font-semibold text-forest-ink">Repeat-offender products</h3>
          <p className="mt-1 text-xs text-forest-muted">Products are ranked by quarantine count, then unresolved events and accumulated resolved downtime.</p>
          {topProducts.length ? (
            <div className="mt-4 space-y-3">
              {topProducts.map((metric) => {
                const product = productById.get(metric.productId);
                return (
                  <div key={metric.productId} className="rounded-xl border border-card-border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-semibold text-forest-ink">{product?.title ?? metric.productId}</p>
                        <p className="mt-1 text-xs text-forest-muted">
                          {metric.events} quarantine(s) · {metric.open} open · median recovery {formatDuration(metric.medianResolvedDurationMs)} · resolved downtime {formatDuration(metric.totalResolvedDowntimeMs)}
                        </p>
                      </div>
                      {product ? <Link href={`/product/${product.slug}`} className="text-xs font-semibold text-forest underline underline-offset-2">View product</Link> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <p className="mt-3 text-sm text-forest-muted">No repeat-offender products are present in the audit window.</p>}
        </div>
      </div>

      <p className="mt-4 text-xs text-forest-muted">
        Supplier-level attribution is intentionally omitted unless a trustworthy supplier identifier is present in the quarantine audit lineage. This dashboard never enables commerce, changes tax state, or authorizes procurement.
      </p>
    </section>
  );
}
