"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const RECONCILIATION_BLOCKER = "manual_purchase_reconciliation_failed";

type ProcurementIntentSummary = {
  id: string;
  status: string;
  executionMode: string;
  blockedReason: string | null;
  supplierOrderReference: string | null;
  actualTotalCostCents: number | null;
  expectedTotalCostCents: number | null;
  currency: string;
  order: {
    orderNumber: string;
  };
  orderItem: {
    title: string;
    quantity: number;
  };
};

type ProcurementListResponse = {
  intents?: ProcurementIntentSummary[];
  automaticSupplierPurchasingEnabled?: boolean;
  error?: string;
};

type IntegrityDetail = {
  procurementIntentId: string;
  executionMode: string;
  automaticSupplierPurchasingEnabled: false;
  resolutionRequiresOwnerConfirmation: true;
  purchaseIntegrity: {
    blockerActive: boolean;
    blockedReason: string | null;
    canResolve: boolean;
    resolutionToken: string | null;
    reconciliation: {
      ok: boolean;
      reasons: string[];
    };
    immutableExecutionEvidence: {
      purchaseEvidenceHash: string;
      supplierOrderKey: string;
      sourceLockKey: string;
      persistedSupplierId: string;
      persistedOfferId: string;
      supplierOrderReference: string;
      quantity: number;
      currency: string;
      actualTotalCostCents: number;
      expectedTotalCostCents: number | null;
      lineRevenueCents: number;
    } | null;
    currentProjection: {
      status: string;
      supplierOrderReference: string | null;
      actualTotalCostCents: number | null;
      executedAt: string | null;
      quantity: number;
      currency: string;
      expectedTotalCostCents: number | null;
      lineRevenueCents: number;
    };
    latestFailure: {
      reasons: string[];
      recordedAt: string;
    } | null;
  };
};

function money(cents: number | null, currency = "usd") {
  if (cents === null) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function readableReason(reason: string) {
  return reason.replaceAll("_", " ");
}

export function ProcurementIntegrityConsole() {
  const [intents, setIntents] = useState<ProcurementIntentSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<IntegrityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  const blocked = useMemo(
    () => intents.filter((intent) => intent.blockedReason === RECONCILIATION_BLOCKER),
    [intents],
  );

  const loadIntents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/procurement", { cache: "no-store" });
      const payload = (await response.json()) as ProcurementListResponse;
      if (!response.ok) throw new Error(payload.error || "PROCUREMENT_LIST_FAILED");
      setIntents(payload.intents || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "PROCUREMENT_LIST_FAILED");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    setDetail(null);
    setError(null);
    setAcknowledged(false);
    setNote("");
    try {
      const response = await fetch(`/api/admin/procurement/${encodeURIComponent(id)}/purchase-integrity`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as IntegrityDetail & { error?: string };
      if (!response.ok) throw new Error(payload.error || "PURCHASE_INTEGRITY_LOAD_FAILED");
      setDetail(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "PURCHASE_INTEGRITY_LOAD_FAILED");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadIntents();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadIntents]);

  async function resolveBlocker() {
    const token = detail?.purchaseIntegrity.resolutionToken;
    if (!selectedId || !token || !acknowledged || note.trim().length < 8) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/procurement/${encodeURIComponent(selectedId)}/purchase-integrity`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "RESOLVE_PURCHASE_RECONCILIATION",
            resolutionToken: token,
            acknowledgedEvidenceMatch: true,
            note: note.trim(),
          }),
        },
      );
      const payload = (await response.json()) as { error?: string; reasons?: string[] };
      if (!response.ok) {
        const suffix = payload.reasons?.length ? `: ${payload.reasons.join(", ")}` : "";
        throw new Error(`${payload.error || "PURCHASE_RECONCILIATION_RECOVERY_FAILED"}${suffix}`);
      }
      await loadIntents();
      await loadDetail(selectedId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "PURCHASE_RECONCILIATION_RECOVERY_FAILED");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 space-y-6">
      <section className="grid gap-3 sm:grid-cols-3">
        <article className="dn-card p-4">
          <p className="text-xs uppercase tracking-wide text-forest-muted">Manual procurement intents</p>
          <p className="mt-1 text-2xl font-bold text-forest">{intents.length}</p>
        </article>
        <article className="dn-card p-4">
          <p className="text-xs uppercase tracking-wide text-forest-muted">Reconciliation blocked</p>
          <p className="mt-1 text-2xl font-bold text-forest">{blocked.length}</p>
        </article>
        <article className="dn-card p-4">
          <p className="text-xs uppercase tracking-wide text-forest-muted">Supplier auto-purchase</p>
          <p className="mt-1 text-lg font-semibold text-forest-ink">Disabled</p>
        </article>
      </section>

      {error ? (
        <div className="rounded-2xl border border-card-border bg-card p-4 text-sm text-forest-ink">
          <strong>Integrity console:</strong> {error}
        </div>
      ) : null}

      <section className="dn-card overflow-hidden p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold text-forest-ink">Purchase reconciliation quarantine</h2>
            <p className="mt-1 max-w-3xl text-sm text-forest-muted">
              A reconciliation blocker never edits purchase, shipment, or delivery history. Repair the underlying projection first; this console can clear the blocker only after the live projection exactly matches immutable purchase evidence.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadIntents()}
            disabled={loading}
            className="rounded-full border border-card-border px-3 py-1.5 text-xs font-semibold text-forest disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {!loading && blocked.length === 0 ? (
            <p className="text-sm text-forest-muted">No manual purchases are quarantined by reconciliation.</p>
          ) : null}
          {blocked.map((intent) => (
            <article key={intent.id} className="rounded-2xl border border-card-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-semibold text-forest-ink">{intent.order.orderNumber} · {intent.orderItem.title}</p>
                  <p className="mt-1 text-xs text-forest-muted">
                    {intent.status} · qty {intent.orderItem.quantity} · supplier ref {intent.supplierOrderReference || "missing"}
                  </p>
                  <p className="mt-1 text-xs text-forest-muted">
                    Expected {money(intent.expectedTotalCostCents, intent.currency)} · recorded {money(intent.actualTotalCostCents, intent.currency)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadDetail(intent.id)}
                  className="rounded-full bg-forest px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Inspect evidence
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {detailLoading ? (
        <section className="dn-card p-5 text-sm text-forest-muted">Loading immutable purchase evidence…</section>
      ) : null}

      {detail ? (
        <section className="dn-card overflow-hidden p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-forest">Selected integrity case</p>
              <h2 className="mt-1 font-display text-xl font-semibold text-forest-ink">
                {detail.purchaseIntegrity.reconciliation.ok ? "Evidence matches now" : "Mismatch still active"}
              </h2>
            </div>
            <span className="rounded-full border border-card-border px-3 py-1 text-xs text-forest-muted">
              {detail.purchaseIntegrity.blockedReason || "No blocker"}
            </span>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <article className="rounded-2xl border border-card-border p-4">
              <h3 className="font-semibold text-forest-ink">Current reconciliation</h3>
              <div className="mt-3 space-y-2 text-sm text-forest-muted">
                <p>Status: <strong className="text-forest-ink">{detail.purchaseIntegrity.currentProjection.status}</strong></p>
                <p>Supplier reference: <strong className="text-forest-ink">{detail.purchaseIntegrity.currentProjection.supplierOrderReference || "missing"}</strong></p>
                <p>Actual supplier cost: <strong className="text-forest-ink">{money(detail.purchaseIntegrity.currentProjection.actualTotalCostCents, detail.purchaseIntegrity.currentProjection.currency)}</strong></p>
                <p>Execution timestamp: <strong className="text-forest-ink">{detail.purchaseIntegrity.currentProjection.executedAt ? new Date(detail.purchaseIntegrity.currentProjection.executedAt).toLocaleString() : "missing"}</strong></p>
              </div>
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-forest-muted">Blocking reasons</p>
                {detail.purchaseIntegrity.reconciliation.reasons.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-forest-ink">
                    {detail.purchaseIntegrity.reconciliation.reasons.map((reason) => (
                      <li key={reason}>{readableReason(reason)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-forest-muted">No current mismatch. The immutable evidence and projection reconcile exactly.</p>
                )}
              </div>
              {detail.purchaseIntegrity.latestFailure ? (
                <div className="mt-4 border-t border-card-border pt-4 text-xs text-forest-muted">
                  Last quarantine: {new Date(detail.purchaseIntegrity.latestFailure.recordedAt).toLocaleString()} · {detail.purchaseIntegrity.latestFailure.reasons.map(readableReason).join(", ") || "reason unavailable"}
                </div>
              ) : null}
            </article>

            <article className="rounded-2xl border border-card-border p-4">
              <h3 className="font-semibold text-forest-ink">Immutable execution evidence</h3>
              {detail.purchaseIntegrity.immutableExecutionEvidence ? (
                <dl className="mt-3 space-y-2 text-xs">
                  <div><dt className="text-forest-muted">Evidence hash</dt><dd className="break-all font-mono text-forest-ink">{detail.purchaseIntegrity.immutableExecutionEvidence.purchaseEvidenceHash}</dd></div>
                  <div><dt className="text-forest-muted">Source lock</dt><dd className="break-all font-mono text-forest-ink">{detail.purchaseIntegrity.immutableExecutionEvidence.sourceLockKey}</dd></div>
                  <div><dt className="text-forest-muted">Supplier / offer</dt><dd className="break-all text-forest-ink">{detail.purchaseIntegrity.immutableExecutionEvidence.persistedSupplierId} / {detail.purchaseIntegrity.immutableExecutionEvidence.persistedOfferId}</dd></div>
                  <div><dt className="text-forest-muted">Supplier order reference</dt><dd className="text-forest-ink">{detail.purchaseIntegrity.immutableExecutionEvidence.supplierOrderReference}</dd></div>
                  <div><dt className="text-forest-muted">Purchase cost</dt><dd className="text-forest-ink">{money(detail.purchaseIntegrity.immutableExecutionEvidence.actualTotalCostCents, detail.purchaseIntegrity.immutableExecutionEvidence.currency)}</dd></div>
                </dl>
              ) : (
                <p className="mt-3 text-sm text-forest-muted">Valid immutable purchase evidence is not available. Resolution is locked.</p>
              )}
            </article>
          </div>

          <div className="mt-5 rounded-2xl border border-card-border p-4">
            <h3 className="font-semibold text-forest-ink">Owner-audited resolution</h3>
            <p className="mt-1 text-sm text-forest-muted">
              This action clears only the reconciliation blocker. It does not change status, supplier reference, cost, inventory, shipment, delivery, payment, refund, or procurement authority.
            </p>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              placeholder="Document how the underlying mismatch was corrected and verified."
              className="mt-4 min-h-24 w-full rounded-xl border border-card-border bg-background p-3 text-sm text-forest-ink"
            />
            <label className="mt-3 flex items-start gap-2 text-sm text-forest-ink">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-1"
              />
              <span>I confirm the current projection now matches the immutable supplier-purchase evidence shown above.</span>
            </label>
            <button
              type="button"
              onClick={() => void resolveBlocker()}
              disabled={!detail.purchaseIntegrity.canResolve || !acknowledged || note.trim().length < 8 || busy}
              className="mt-4 rounded-full bg-forest px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Verifying…" : "Verify exact match and clear blocker"}
            </button>
            {!detail.purchaseIntegrity.canResolve ? (
              <p className="mt-2 text-xs text-forest-muted">Resolution remains disabled until the server reports an exact evidence match.</p>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
