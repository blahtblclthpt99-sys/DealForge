"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const CARRIERS = ["ups", "usps", "fedex", "dhl", "other"] as const;
type CarrierCode = (typeof CARRIERS)[number];

type Shipment = {
  packageId: string;
  status: "shipped" | "delivered";
  carrierName: string;
  trackingNumber: string;
  trackingUrl: string | null;
  quantity: number;
  shippedAt: string;
  deliveredAt: string | null;
};

type FulfillmentIntent = {
  id: string;
  status: string;
  executionMode: string;
  blockedReason: string | null;
  supplierOrderReference: string | null;
  order: { orderNumber: string };
  orderItem: { title: string; quantity: number };
  shipments?: Shipment[];
  fulfillment?: {
    journalValid: boolean;
    orderedQuantity: number;
    shippedQuantity: number | null;
    deliveredQuantity: number | null;
    remainingToShip: number | null;
    reason?: string;
  };
};

type ListResponse = {
  intents?: FulfillmentIntent[];
  error?: string;
};

function dateLabel(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}

function FulfillmentCard({ intent, onChanged }: { intent: FulfillmentIntent; onChanged: () => Promise<void> }) {
  const [carrierCode, setCarrierCode] = useState<CarrierCode>("ups");
  const [carrierName, setCarrierName] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [quantity, setQuantity] = useState(String(intent.fulfillment?.remainingToShip ?? intent.orderItem.quantity));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shipments = intent.shipments || [];
  const remaining = intent.fulfillment?.remainingToShip ?? null;
  const canShip =
    intent.executionMode === "manual_only" &&
    !intent.blockedReason &&
    intent.fulfillment?.journalValid !== false &&
    (intent.status === "supplier_ordered_manual" || intent.status === "shipped") &&
    remaining !== null &&
    remaining > 0;

  async function postAction(body: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey);
    setError(null);
    try {
      const response = await fetch(`/api/admin/procurement/${encodeURIComponent(intent.id)}/shipment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "FULFILLMENT_ACTION_FAILED");
      setTrackingNumber("");
      setNote("");
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "FULFILLMENT_ACTION_FAILED");
    } finally {
      setBusy(null);
    }
  }

  async function recordShipment() {
    if (!canShip) return;
    const parsedQuantity = Number.parseInt(quantity, 10);
    if (!Number.isSafeInteger(parsedQuantity) || parsedQuantity <= 0 || (remaining !== null && parsedQuantity > remaining)) {
      setError("SHIPMENT_QUANTITY_INVALID");
      return;
    }
    if (trackingNumber.trim().length < 4) {
      setError("TRACKING_NUMBER_REQUIRED");
      return;
    }
    await postAction(
      {
        action: "RECORD_SHIPMENT",
        expectedState: intent.status,
        carrierCode,
        ...(carrierCode === "other" ? { carrierName: carrierName.trim() } : {}),
        trackingNumber: trackingNumber.trim(),
        quantity: parsedQuantity,
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      "ship",
    );
  }

  async function markDelivered(packageId: string) {
    await postAction(
      {
        action: "MARK_DELIVERED",
        expectedState: "shipped",
        packageId,
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      packageId,
    );
  }

  return (
    <article className="rounded-2xl border border-card-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-forest-ink">{intent.order.orderNumber} · {intent.orderItem.title}</p>
          <p className="mt-1 text-xs text-forest-muted">
            {intent.status} · supplier ref {intent.supplierOrderReference || "missing"}
          </p>
        </div>
        <span className="rounded-full border border-card-border px-3 py-1 text-xs text-forest-muted">
          {intent.fulfillment?.journalValid === false ? "Journal blocked" : "Manual fulfillment"}
        </span>
      </div>

      <div className="mt-4 grid gap-2 text-xs text-forest-muted sm:grid-cols-4">
        <p>Ordered <strong className="text-forest-ink">{intent.fulfillment?.orderedQuantity ?? intent.orderItem.quantity}</strong></p>
        <p>Shipped <strong className="text-forest-ink">{intent.fulfillment?.shippedQuantity ?? 0}</strong></p>
        <p>Delivered <strong className="text-forest-ink">{intent.fulfillment?.deliveredQuantity ?? 0}</strong></p>
        <p>Remaining <strong className="text-forest-ink">{remaining ?? "—"}</strong></p>
      </div>

      {intent.fulfillment?.journalValid === false ? (
        <p className="mt-3 rounded-xl border border-card-border p-3 text-sm text-forest-ink">
          Fulfillment journal requires investigation: {intent.fulfillment.reason || "invalid journal"}.
        </p>
      ) : null}

      {shipments.length ? (
        <div className="mt-4 space-y-2">
          {shipments.map((shipment, index) => (
            <div key={shipment.packageId} className="rounded-xl border border-card-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="text-xs text-forest-muted">
                  <p className="font-semibold text-forest-ink">Package {index + 1} · Qty {shipment.quantity}</p>
                  <p className="mt-1">{shipment.carrierName} · {shipment.trackingNumber}</p>
                  <p className="mt-1">Shipped {dateLabel(shipment.shippedAt)}</p>
                  <p className="mt-1">Delivered {dateLabel(shipment.deliveredAt)}</p>
                </div>
                {shipment.status !== "delivered" && intent.status === "shipped" && !intent.blockedReason ? (
                  <button
                    type="button"
                    onClick={() => void markDelivered(shipment.packageId)}
                    disabled={Boolean(busy)}
                    className="rounded-full border border-card-border px-3 py-1.5 text-xs font-semibold text-forest disabled:opacity-40"
                  >
                    {busy === shipment.packageId ? "Recording…" : "Mark delivered"}
                  </button>
                ) : (
                  <span className="text-xs font-semibold capitalize text-forest">{shipment.status}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {canShip ? (
        <div className="mt-4 rounded-xl border border-card-border p-4">
          <h3 className="text-sm font-semibold text-forest-ink">Record package</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <select
              value={carrierCode}
              onChange={(event) => setCarrierCode(event.target.value as CarrierCode)}
              className="rounded-xl border border-card-border bg-background p-2 text-sm text-forest-ink"
            >
              {CARRIERS.map((carrier) => <option key={carrier} value={carrier}>{carrier.toUpperCase()}</option>)}
            </select>
            {carrierCode === "other" ? (
              <input
                value={carrierName}
                onChange={(event) => setCarrierName(event.target.value)}
                maxLength={60}
                placeholder="Carrier name"
                className="rounded-xl border border-card-border bg-background p-2 text-sm text-forest-ink"
              />
            ) : null}
            <input
              value={trackingNumber}
              onChange={(event) => setTrackingNumber(event.target.value)}
              maxLength={100}
              placeholder="Tracking number"
              className="rounded-xl border border-card-border bg-background p-2 text-sm text-forest-ink"
            />
            <input
              type="number"
              min={1}
              max={remaining ?? undefined}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="rounded-xl border border-card-border bg-background p-2 text-sm text-forest-ink"
            />
          </div>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            placeholder="Optional fulfillment note"
            className="mt-3 min-h-20 w-full rounded-xl border border-card-border bg-background p-3 text-sm text-forest-ink"
          />
          <button
            type="button"
            onClick={() => void recordShipment()}
            disabled={Boolean(busy)}
            className="mt-3 rounded-full bg-forest px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy === "ship" ? "Recording…" : "Record package"}
          </button>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-forest-ink">Fulfillment action: {error}</p> : null}
    </article>
  );
}

export function ProcurementFulfillmentConsole() {
  const [intents, setIntents] = useState<FulfillmentIntent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/procurement", { cache: "no-store" });
      const payload = (await response.json()) as ListResponse;
      if (!response.ok) throw new Error(payload.error || "PROCUREMENT_LIST_FAILED");
      setIntents(payload.intents || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "PROCUREMENT_LIST_FAILED");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const fulfillmentIntents = useMemo(
    () => intents.filter((intent) =>
      intent.executionMode === "manual_only" &&
      ["supplier_ordered_manual", "shipped", "delivered"].includes(intent.status),
    ),
    [intents],
  );

  return (
    <section className="dn-card mt-8 overflow-hidden p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-forest">Fulfillment</p>
          <h2 className="mt-1 font-display text-xl font-semibold text-forest-ink">Multi-package shipment journal</h2>
          <p className="mt-1 max-w-3xl text-sm text-forest-muted">
            Record packages and delivery manually. DealForge never places supplier orders or polls carriers from this surface.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-full border border-card-border px-3 py-1.5 text-xs font-semibold text-forest disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? <p className="mt-4 text-sm text-forest-ink">Fulfillment console: {error}</p> : null}
      {!loading && fulfillmentIntents.length === 0 ? (
        <p className="mt-5 text-sm text-forest-muted">No manually purchased orders are awaiting fulfillment.</p>
      ) : null}

      <div className="mt-5 space-y-4">
        {fulfillmentIntents.map((intent) => (
          <FulfillmentCard
            key={`${intent.id}:${intent.status}:${intent.fulfillment?.remainingToShip ?? "x"}:${intent.shipments?.length ?? 0}`}
            intent={intent}
            onChanged={load}
          />
        ))}
      </div>
    </section>
  );
}
