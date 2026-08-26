import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  COMMERCE_QUARANTINE_ACTIONS,
  COMMERCE_QUARANTINE_RESOLUTION_ACTION,
  deriveCommerceQuarantineRecords,
  deriveCommerceQuarantineResolutions,
} from "@/lib/commerce-quarantine";

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
        select: { id: true, title: true, slug: true, availability: true, commerceEnabled: true },
      })
    : [];
  const productById = new Map(products.map((product) => [product.id, product]));
  const active = records.filter((record) => productById.get(record.productId)?.commerceEnabled === false);

  return (
    <section id="quarantine-recovery" className="dn-card mt-6 min-w-0 scroll-mt-6 overflow-hidden p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-forest-ink">Quarantine & recovery queue</h2>
          <p className="mt-1 max-w-3xl text-sm text-forest-muted">
            Automatically paused products stay blocked until their failed evidence is refreshed and the owner commercialization gate passes again.
          </p>
        </div>
        <span className="rounded-full border border-card-border px-3 py-1 text-xs font-semibold text-forest-muted">{active.length} blocked</span>
      </div>

      {active.length ? (
        <div className="mt-5 space-y-4">
          {active.map((record) => {
            const product = productById.get(record.productId)!;
            return (
              <article key={record.auditId} className="rounded-2xl border border-card-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="break-words font-semibold text-forest-ink">{product.title}</h3>
                    <p className="mt-1 text-xs text-forest-muted">Paused {record.quarantinedAt.toLocaleString()} · inventory: {product.availability}</p>
                  </div>
                  <Link href={`/product/${product.slug}`} className="text-xs font-semibold text-forest underline underline-offset-2">View product</Link>
                </div>

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
            );
          })}
        </div>
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

      <p className="mt-4 text-xs text-forest-muted">This surface is read-only. It never enables commerce, changes tax compliance state, or authorizes supplier purchasing.</p>
    </section>
  );
}
