import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { productEngineDashboard } from "@/lib/product-engine";
import { ProductEngineControls } from "@/components/product-engine-controls";

export const dynamic = "force-dynamic";

export default async function ProductEnginePage() {
  const session = await readSession();
  if (!session) redirect("/login?next=/admin/product-engine");

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { email: true, role: true },
  });
  const ownerEmail = process.env.PRODUCT_ENGINE_OWNER_EMAIL?.trim().toLowerCase();

  // Fail closed: this route is owner-only, not merely hidden from navigation.
  if (!ownerEmail || !user || user.role !== "admin" || user.email.toLowerCase() !== ownerEmail) {
    redirect("/dashboard");
  }

  const data = await productEngineDashboard();
  const states = new Map(data.workers.map((worker) => [worker.worker, worker]));
  const stageNames = ["scout-a", "scout-b", "validator", "classifier", "publisher"];
  const metric = (state: string) => data.counts[state] ?? 0;

  return (
    <main className="dn-container min-w-0 py-8 sm:py-12">
      <div className="max-w-full overflow-hidden">
        <p className="text-sm font-medium uppercase tracking-wide text-forest">Owner tools</p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-forest-ink sm:text-4xl">Product Engine</h1>
        <p className="mt-2 max-w-3xl text-sm text-forest-muted">
          Compliant candidate intake. Amazon pages are not scraped; unverified Amazon price and review data are suppressed.
        </p>
      </div>

      <section className="mt-6 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {stageNames.map((name) => {
          const worker = states.get(name);
          return (
            <article key={name} className="dn-card min-w-0 p-4">
              <p className="truncate text-xs uppercase tracking-wide text-forest-muted">{name.replace("-", " ")}</p>
              <p className="mt-2 font-semibold capitalize text-forest-ink">{worker?.status ?? "idle"}</p>
              <p className="mt-1 text-xs text-forest-muted">{worker?.healthy === false ? "Needs attention" : "Healthy"}</p>
            </article>
          );
        })}
      </section>

      <section className="mt-6 grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          ["Discovered", metric("discovered")],
          ["Pending", metric("validating")],
          ["Validated", metric("validated")],
          ["Classified", metric("classified")],
          ["Published", metric("published")],
          ["Rejected", metric("rejected")],
          ["Dead letter", metric("dead_letter")],
          ["Duplicates", data.duplicates],
          ["Paused", data.config.paused ? "Yes" : "No"],
          ["Threshold", data.config.acceptanceThreshold],
        ].map(([label, value]) => (
          <article key={String(label)} className="dn-card min-w-0 p-4">
            <p className="break-words text-xs uppercase tracking-wide text-forest-muted">{label}</p>
            <p className="mt-1 break-words text-2xl font-bold text-forest">{String(value)}</p>
          </article>
        ))}
      </section>

      <ProductEngineControls
        paused={data.config.paused}
        candidates={data.candidates.map((candidate) => ({
          id: candidate.id,
          asin: candidate.asin,
          title: candidate.titleCandidate,
          state: candidate.state,
          score: candidate.score,
          category: candidate.normalizedCategory,
          rejectionReason: candidate.rejectionReason,
        }))}
      />

      <section className="mt-8 grid min-w-0 gap-5 lg:grid-cols-2">
        <article className="dn-card min-w-0 overflow-hidden p-5">
          <h2 className="font-display text-xl font-semibold text-forest-ink">Category distribution</h2>
          <div className="mt-4 space-y-2">
            {Object.entries(data.categories).length ? (
              Object.entries(data.categories).map(([name, count]) => (
                <div key={name} className="flex min-w-0 justify-between gap-3 text-sm">
                  <span className="truncate text-forest-muted">{name}</span>
                  <strong className="text-forest-ink">{count}</strong>
                </div>
              ))
            ) : (
              <p className="text-sm text-forest-muted">No classified candidates yet.</p>
            )}
          </div>
        </article>

        <article className="dn-card min-w-0 overflow-hidden p-5">
          <h2 className="font-display text-xl font-semibold text-forest-ink">Rejection reasons</h2>
          <div className="mt-4 space-y-2">
            {Object.entries(data.rejectionReasons).length ? (
              Object.entries(data.rejectionReasons).map(([name, count]) => (
                <div key={name} className="flex min-w-0 justify-between gap-3 text-sm">
                  <span className="break-all text-forest-muted">{name}</span>
                  <strong className="text-forest-ink">{count}</strong>
                </div>
              ))
            ) : (
              <p className="text-sm text-forest-muted">No rejections recorded.</p>
            )}
          </div>
        </article>
      </section>

      <section className="dn-card mt-8 min-w-0 overflow-hidden p-5">
        <h2 className="font-display text-xl font-semibold text-forest-ink">Activity / audit log</h2>
        <div className="mt-4 max-h-[28rem] overflow-auto">
          <div className="min-w-[520px] space-y-2">
            {data.audits.map((entry) => (
              <div key={entry.id} className="grid grid-cols-[10rem_8rem_1fr] gap-3 border-b border-card-border py-2 text-xs">
                <span className="text-forest-muted">{entry.createdAt.toLocaleString()}</span>
                <span className="truncate font-medium text-forest-ink">{entry.actor}</span>
                <span className="break-words text-forest-muted">{entry.action}{entry.toState ? ` → ${entry.toState}` : ""}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-4 text-xs text-forest-muted">
          Last run: {data.config.lastRunAt?.toLocaleString() ?? "Never"} · Last successful publication: {data.config.lastPublishedAt?.toLocaleString() ?? "Never"}
        </p>
      </section>
    </main>
  );
}
