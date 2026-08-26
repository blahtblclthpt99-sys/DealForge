import { preventiveValidationCoverage, summarizeValidationCoverage } from "@/lib/preventive-validation-coverage";

function label(value: string) {
  return value.replaceAll("_", " ");
}

const STATUS_LABELS = {
  preflight: "Preflight",
  persisted_selection: "Persisted selection",
  runtime_monitor: "Runtime monitor",
  legacy_alias: "Legacy alias",
  unmapped: "Unmapped",
} as const;

export function PreventiveValidationCoverageMatrix() {
  const entries = preventiveValidationCoverage();
  const summary = summarizeValidationCoverage(entries);
  const gaps = entries.filter((entry) => entry.status === "runtime_monitor" || entry.status === "unmapped");

  return (
    <section id="preventive-validation-coverage" className="dn-card mt-6 min-w-0 scroll-mt-6 overflow-hidden p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-forest-ink">Preventive validation coverage matrix</h2>
          <p className="mt-1 max-w-3xl text-sm text-forest-muted">
            Maps quarantine failure reasons to the earliest deterministic validator that currently catches them. This is a read-only engineering coverage view; it does not alter commerce, tax, publication, or procurement authority.
          </p>
        </div>
        <span className="rounded-full border border-card-border px-3 py-1 text-xs font-semibold text-forest-muted">{summary.total} mapped reasons</span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Preflight", summary.preflight],
          ["Persisted", summary.persisted_selection],
          ["Runtime", summary.runtime_monitor],
          ["Legacy", summary.legacy_alias],
          ["Unmapped", summary.unmapped],
          ["Coverage gaps", gaps.length],
        ].map(([name, value]) => (
          <article key={String(name)} className="rounded-2xl border border-card-border p-3">
            <p className="text-xs uppercase tracking-wide text-forest-muted">{name}</p>
            <p className="mt-1 text-2xl font-semibold text-forest-ink">{value}</p>
          </article>
        ))}
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="min-w-[960px] w-full text-left text-xs">
          <thead>
            <tr className="border-b border-card-border text-forest-muted">
              <th className="px-2 py-2 font-semibold">Reason</th>
              <th className="px-2 py-2 font-semibold">Domain</th>
              <th className="px-2 py-2 font-semibold">Coverage</th>
              <th className="px-2 py-2 font-semibold">Earliest stage</th>
              <th className="px-2 py-2 font-semibold">Validator</th>
              <th className="px-2 py-2 font-semibold">Engineering note</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.reason} className="border-b border-card-border align-top">
                <td className="px-2 py-3 font-medium text-forest-ink">{label(entry.reason)}</td>
                <td className="px-2 py-3 capitalize text-forest-muted">{label(entry.domain)}</td>
                <td className="px-2 py-3 text-forest-muted">{STATUS_LABELS[entry.status]}</td>
                <td className="px-2 py-3 text-forest-muted">{entry.stage}</td>
                <td className="px-2 py-3 text-forest-muted"><span className="font-medium text-forest-ink">{entry.validator}</span><span className="mt-1 block break-all">{entry.source}</span></td>
                <td className="px-2 py-3 text-forest-muted">{entry.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 rounded-2xl border border-card-border p-4">
        <h3 className="font-display text-lg font-semibold text-forest-ink">Highest-confidence hardening target</h3>
        <p className="mt-2 text-sm text-forest-muted">
          InventoryObservation freshness is explicitly validated by the runtime freshness subsystem, but owner commercialization currently relies on selected-offer availability and confidence rather than binding the commercialization decision to a specific fresh InventoryObservation record. Treat this as a coverage gap to close with an evidence-binding contract before making it a new mandatory gate.
        </p>
      </div>

      <p className="mt-4 text-xs text-forest-muted">Legacy aliases are retained for historical recovery compatibility and should not be counted as missing active validators.</p>
    </section>
  );
}
