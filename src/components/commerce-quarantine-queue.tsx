import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  COMMERCE_QUARANTINE_ACTIONS,
  COMMERCE_QUARANTINE_RESOLUTION_ACTION,
  deriveCommerceQuarantineRecords,
  deriveCommerceQuarantineResolutions,
} from "@/lib/commerce-quarantine";
import { rankQuarantineRecoveryQueue } from "@/lib/commerce-quarantine-priority";

function reasonLabel(reason: string) {
  return reason.replaceAll("_", " ");
}

function formatDuration(ms: number | null) {
  if (ms === null) return "duration unavailable";
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hr`;
  return `${Math.round(hours / 24)} days`;
}

function priorityLabel(band: "critical" | "high" | "medium" | "low") {
  return `${band} recovery priority`;
}

export async function CommerceQuarantineQueue() {
  const audits = await prisma.productEngineAudit.findMany({
    where: { action: { in: [...COMMERCE_QUARANTINE_ACTIONS, COMMERCE_QUARANTINE_RESOLUTION_ACTION] } },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { id: true, action: true, detail: true, createdAt: true },
  });
  const records = deriveCommerceQuarantineRecords(audits);
  const resolutions = deriveCommerceQuarantineResolutions(audits).slice(0, 25);
  const productIds = [...new Set([...records.map((record) => record.productId), ...resolutions.map((record) => record.productId)])];
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          title: true,
          slug: true,
          availability: true,
          commerceEnabled: true,
          sellingPriceCents: true,
          viewCount: true,
          clickCount: true,
          trendingScore: true,
        },
      })
    : [];
  const productById = new Map(products.map((product) => [product.id, product]));
  const activeRecords = records.filter((record) => productById.get(record.productId)?.commerceEnabled === false);
  const ranked = rankQuarantineRecoveryQueue(activeRecords, products, new Date());
  const criticalCount = ranked.filter((entry) => entry.priority.band === "critical").length;
  const highCount = ranked.filter((entry) => entry.priority.band === "high").length;
  const reasonCounts = new Map<string, number>();
  for (const entry of ranked) {
    for (const reason of entry.record.reasons) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
  const recurringReasons = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5);

  return (
    <section id="quarantine-recovery" className="dn-card mt-6 min-w-0 scroll-mt-6 overflow-hidden p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-forest-ink">Quarantine & recovery queue</h2>
          <p className="mt-1 max-w-3xl text-sm text-forest-muted">
            Automatically paused products stay blocked until their failed evidence is refreshed and the owner commercialization gate passes again. The queue is ranked for owner triage only.
          </p>
        </div>
        <span className="rounded-full border border-card-border px-3 py-1 text-xs font-semibold text-forest-muted">{ranked.length} blocked</span>
      </div>

      {ranked.length ? (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-card-border p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-forest-muted">Urgent queue</p>
              <p className="mt-1 text-2xl font-semibold text-forest-ink">{criticalCount + highCount}</p>
              <p className="mt-1 text-xs text-forest-muted">{criticalCount} critical · {highCount} high</p>
            </div>
            <div className="rounded-2xl border border-card-border p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-forest-muted">Oldest block</p>
              <p className="mt-1 text-lg font-semibold text-forest-ink">{formatDuration(Math.max(...ranked.map((entry) => entry.priority.blockedDurationMs)))}</p>
              <p className="mt-1 text-xs text-forest-muted">Time blocked, not an SLA.</p>
            </div>
            <div className="rounded-2xl border border-card-border p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-forest-muted">Most common cause</p>
              <p className="mt-1 break-words text-sm font-semibold text-forest-ink">{recurringReasons[0] ? reasonLabel(recurringReasons[0][0]) : "none"}</p>
              <p className="mt-1 text-xs text-forest-muted">{recurringReasons[0]?.[1] ?? 0} currently blocked product(s)</p>
            </div>
          </div>

          {recurringReasons.length ? (
            <div className="mt-4 rounded-2xl border border-card-border p-4">
              <h3 className="text-sm font-semibold text-forest-ink">Recurring blocker concentration</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {recurringReasons.map(([reason, count]) => (
                  <span key={reason} className="rounded-full border border-card-border px-2.5 py-1 text-xs text-forest-muted">
                    {reasonLabel(reason)} · {count}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-5 space-y-4">
            {ranked.map(({ record, product, priority }, index) => (
              <article key={record.auditId} className="rounded-2xl border border-card-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-card-border px-2.5 py-1 text-xs font-semibold text-forest-ink">#{index + 1}</span>
                      <span className="rounded-full border border-card-border px-2.5 py-1 text-xs font-semibold text-forest-ink">{priorityLabel(priority.band)}</span>
                      <span className="text-xs text-forest-muted">score {priority.score}/1000</span>
                    </div>
                    <h3 className="mt-2 break-words font-semibold text-forest-ink">{product.title}</h3>
                    <p className="mt-1 text-xs text-forest-muted">
                      Paused {record.quarantinedAt.toLocaleString()} · blocked {formatDuration(priority.blockedDurationMs)} · inventory: {product.availability}
                    </p>
                  </div>
                  <Link href={`/product/${product.slug}`} className="text-xs font-semibold text-forest underline underline-offset-2">View product</Link>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  <div className="rounded-xl border border-card-border px-3 py-2 text-xs text-forest-muted">Safety severity <strong className="text-forest-ink">{priority.reasonRiskScore}/100</strong></div>
                  <div className="rounded-xl border border-card-border px-3 py-2 text-xs text-forest-muted">Blocked-age <strong className="text-forest-ink">{priority.ageScore}/100</strong></div>
                  <div className="rounded-xl border border-card-border px-3 py-2 text-xs text-forest-muted">Demand signal <strong className="text-forest-ink">{priority.demandScore}/100</strong></div>
                  <div className="rounded-xl border border-card-border px-3 py-2 text-xs text-forest-muted">Exposure signal <strong className="text-forest-ink">{priority.estimatedExposureScore}/100</strong></div>
                </div>
                <p className="mt-2 text-xs text-forest-muted">Primary blocker: {reasonLabel(priority.primaryReason)}. Demand/exposure scores are bounded triage heuristics, not revenue forecasts.</p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {record.reasons.map((reason) => (
                    <span key={reason} className="rounded-full border border-card-border px-2.5 py-1 text-xs text-forest-muted">{reasonLabel(reason)}</span>
                  ))}
                </div>

                <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-forest-muted">
                  {record.recoverySteps.map((step) => <li key={step}>{step}</li>)}
                </ol>

                <a href="#commercial-gate" className="mt-4 inline-flex rounded-xl border border-card-border px-3 py-2 text-xs font-semibold text-forest-ink">
                  Refresh evidence in Commerce Gate
                </a>
              </article>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-4 text-sm text-forest-muted">No currently disabled products have an unresolved automatic quarantine event.</p>
      )}

      <div className="mt-6 border-t border-card-border pt-5">
        <h3 className="font-display text-lg font-semibold text-forest-ink">Resolved quarantine history</h3>
        <p className="mt-1 text-sm text-forest-muted">Successful recovery is recorded only after the owner commercialization gate revalidates the full evidence bundle.</p>
        {resolutions.length ? (
          <div className="mt-4 space-y-3">
            {resolutions.map((resolution) => {
              const product = productById.get(resolution.productId);
              return (
                <article key={resolution.auditId} className="rounded-2xl border border-card-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold text-forest-ink">{product?.title ?? resolution.productId}</p>
                      <p className="mt-1 text-xs text-forest-muted">Resolved {resolution.resolvedAt.toLocaleString()} · blocked {formatDuration(resolution.blockedDurationMs)}</p>
                    </div>
                    {product ? <Link href={`/product/${product.slug}`} className="text-xs font-semibold text-forest underline underline-offset-2">View product</Link> : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {resolution.quarantineReasons.map((reason) => (
                      <span key={reason} className="rounded-full border border-card-border px-2.5 py-1 text-xs text-forest-muted">cleared: {reasonLabel(reason)}</span>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-sm text-forest-muted">No quarantine recovery has been recorded yet.</p>
        )}
      </div>

      <p className="mt-4 text-xs text-forest-muted">This surface is read-only. Priority scores never enable commerce, change tax compliance state, or authorize supplier purchasing.</p>
    </section>
  );
}
