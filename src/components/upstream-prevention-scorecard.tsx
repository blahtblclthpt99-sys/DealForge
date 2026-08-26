import { prisma } from "@/lib/db";
import { COMMERCE_QUARANTINE_ACTIONS, COMMERCE_QUARANTINE_RESOLUTION_ACTION } from "@/lib/commerce-quarantine";
import { calculateQuarantinePerformanceAnalytics } from "@/lib/commerce-quarantine-analytics";
import { buildUpstreamPreventionScorecard } from "@/lib/upstream-prevention-scorecard";

function label(value: string) {
  return value.replaceAll("_", " ");
}

function formatDuration(ms: number | null) {
  if (ms === null) return "n/a";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return `${hours} hr`;
  return `${Math.round(hours / 24)} days`;
}

export async function UpstreamPreventionScorecard() {
  const audits = await prisma.productEngineAudit.findMany({
    where: { action: { in: [...COMMERCE_QUARANTINE_ACTIONS, COMMERCE_QUARANTINE_RESOLUTION_ACTION] } },
    orderBy: { createdAt: "desc" },
    take: 2000,
    select: { id: true, action: true, detail: true, createdAt: true },
  });
  const analytics = calculateQuarantinePerformanceAnalytics(audits, new Date());
  const scorecard = buildUpstreamPreventionScorecard(analytics.reasons);

  return (
    <section id="upstream-prevention" className="dn-card mt-6 min-w-0 scroll-mt-6 overflow-hidden p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-forest-ink">Upstream prevention scorecard</h2>
          <p className="mt-1 max-w-3xl text-sm text-forest-muted">
            Historical quarantine failures are grouped into evidence domains so the owner can strengthen checks before publication. Scores are advisory and never change publication, commerce, tax, or procurement state.
          </p>
        </div>
        <span className="rounded-full border border-card-border px-3 py-1 text-xs font-semibold text-forest-muted">latest 2,000 audit rows</span>
      </div>

      {scorecard.length ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {scorecard.map((entry, index) => (
            <article key={entry.domain} className="rounded-2xl border border-card-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-forest-muted">#{index + 1} prevention priority</p>
                  <h3 className="mt-1 font-display text-lg font-semibold capitalize text-forest-ink">{label(entry.domain)}</h3>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold text-forest-ink">{entry.score}/100</p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-forest-muted">{entry.band}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-forest-muted">
                <div className="rounded-xl border border-card-border p-2">Events <strong className="block text-forest-ink">{entry.events}</strong></div>
                <div className="rounded-xl border border-card-border p-2">Open <strong className="block text-forest-ink">{entry.open}</strong></div>
                <div className="rounded-xl border border-card-border p-2">Median downtime <strong className="block text-forest-ink">{formatDuration(entry.medianResolvedDurationMs)}</strong></div>
              </div>
              <p className="mt-3 text-sm text-forest-muted">{entry.recommendation}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {entry.reasons.slice(0, 6).map((reason) => (
                  <span key={reason} className="rounded-full border border-card-border px-2.5 py-1 text-xs text-forest-muted">{label(reason)}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-forest-muted">No quarantine evidence exists yet, so no historical prevention priorities can be calculated.</p>
      )}

      <p className="mt-4 text-xs text-forest-muted">This scorecard is read-only. A high score is a recommendation to improve validation coverage; it is not an automatic rejection threshold.</p>
    </section>
  );
}
