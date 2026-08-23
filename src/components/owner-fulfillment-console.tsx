"use client";

import { useCallback, useEffect, useState } from "react";
import { PackageCheck, RefreshCw, ShieldAlert, Truck } from "lucide-react";

type FulfillmentState =
  | "awaiting_sourcing"
  | "sourcing"
  | "supplier_ordered"
  | "shipped"
  | "delivered"
  | "hold";

type OrderItem = {
  id: string;
  title: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  landedCostCents: number | null;
};

type CommerceOrder = {
  id: string;
  orderNumber: string;
  email: string;
  financialStatus: string;
  currency: string;
  totalCents: number;
  refundedCents: number;
  paidAt: string | null;
  paymentCertified: boolean;
  fulfillmentState: FulfillmentState | null;
  lastFulfillmentAction: string | null;
  lastFulfillmentAt: string | null;
  orderItems: OrderItem[];
};

function money(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function cents(value: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const result = Math.round(amount * 100);
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

async function readJson(response: Response) {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

function OrderCard({ order, reload }: { order: CommerceOrder; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [holdReason, setHoldReason] = useState("");
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [acceptVariance, setAcceptVariance] = useState(false);
  const [acceptLoss, setAcceptLoss] = useState(false);
  const [supplierLines, setSupplierLines] = useState<Record<string, { reference: string; cost: string }>>(
    Object.fromEntries(order.orderItems.map((item) => [item.id, { reference: "", cost: item.landedCostCents ? String((item.landedCostCents * item.quantity) / 100) : "" }])),
  );

  const state = order.fulfillmentState;

  async function act(body: Record<string, unknown>) {
    if (!state) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/commerce/orders/${encodeURIComponent(order.id)}/fulfillment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, expectedState: state }),
      });
      const data = await readJson(response);
      if (!response.ok) {
        const variance = typeof data.costVarianceCents === "number" ? ` Cost variance: ${money(data.costVarianceCents)}.` : "";
        setError(`${String(data.error || "Fulfillment action failed")}.${variance}`);
        return;
      }
      setMessage(`Order moved to ${String(data.nextState || "the next stage").replaceAll("_", " ")}.`);
      await reload();
    } catch {
      setError("Could not reach the fulfillment service.");
    } finally {
      setBusy(false);
    }
  }

  const supplierOrders = order.orderItems.map((item) => {
    const entry = supplierLines[item.id] || { reference: "", cost: "" };
    return {
      orderItemId: item.id,
      supplierOrderReference: entry.reference.trim(),
      actualCostCents: cents(entry.cost),
    };
  });
  const supplierReady = supplierOrders.every((line) => line.supplierOrderReference.length >= 2 && line.actualCostCents != null);

  return (
    <article className="rounded-2xl border border-card-border bg-background p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-forest-muted">{order.orderNumber}</p>
          <h3 className="mt-1 text-lg font-bold text-forest-ink">{money(order.totalCents)} · {order.orderItems.length} line(s)</h3>
          <p className="mt-1 text-xs text-forest-muted">Payment: {order.financialStatus} · Fulfillment: {state?.replaceAll("_", " ") || "blocked"}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${order.paymentCertified ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-300"}`}>
          {order.paymentCertified ? "Payment ledger verified" : "Payment ledger blocked"}
        </span>
      </div>

      <div className="mt-4 space-y-2">
        {order.orderItems.map((item) => (
          <div key={item.id} className="rounded-xl border border-card-border/70 p-3 text-sm">
            <p className="font-semibold text-forest-ink">{item.quantity}× {item.title}</p>
            <p className="mt-1 text-xs text-forest-muted">Customer line {money(item.lineTotalCents)} · reviewed landed cost {money(item.landedCostCents == null ? null : item.landedCostCents * item.quantity)}</p>
          </div>
        ))}
      </div>

      {state === "awaiting_sourcing" ? (
        <button disabled={busy || !order.paymentCertified} onClick={() => void act({ action: "START_SOURCING" })} className="mt-4 min-h-11 rounded-xl bg-[#F97316] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
          Start manual sourcing
        </button>
      ) : null}

      {state === "sourcing" ? (
        <div className="mt-4 space-y-3 rounded-xl border border-[#F97316]/25 bg-[#F97316]/5 p-4">
          <p className="text-sm font-bold text-forest-ink">Record manual supplier purchase</p>
          {order.orderItems.map((item) => {
            const entry = supplierLines[item.id] || { reference: "", cost: "" };
            return (
              <div key={item.id} className="grid gap-2 sm:grid-cols-2">
                <input aria-label={`Supplier reference for ${item.title}`} value={entry.reference} onChange={(event) => setSupplierLines((current) => ({ ...current, [item.id]: { ...entry, reference: event.target.value.slice(0, 120) } }))} placeholder="Supplier order/reference #" className="min-h-11 rounded-xl border border-card-border bg-background px-3 text-sm" />
                <input aria-label={`Actual supplier cost for ${item.title}`} value={entry.cost} onChange={(event) => setSupplierLines((current) => ({ ...current, [item.id]: { ...entry, cost: event.target.value.slice(0, 20) } }))} inputMode="decimal" placeholder="Actual total line cost ($)" className="min-h-11 rounded-xl border border-card-border bg-background px-3 text-sm" />
              </div>
            );
          })}
          <label className="flex gap-2 text-xs text-forest-muted"><input type="checkbox" checked={acceptVariance} onChange={(event) => setAcceptVariance(event.target.checked)} /> I reviewed and accept any supplier cost above the saved landed-cost estimate.</label>
          <label className="flex gap-2 text-xs text-forest-muted"><input type="checkbox" checked={acceptLoss} onChange={(event) => setAcceptLoss(event.target.checked)} /> I explicitly accept loss risk if supplier cost reaches or exceeds the customer order total.</label>
          <button disabled={busy || !supplierReady} onClick={() => void act({ action: "MARK_SUPPLIER_ORDERED", manualPurchaseConfirmed: true, supplierOrders: supplierOrders.map((line) => ({ ...line, actualCostCents: line.actualCostCents as number })), acceptCostVariance: acceptVariance, acceptLossRisk: acceptLoss })} className="min-h-11 rounded-xl bg-[#F97316] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
            Confirm supplier ordered manually
          </button>
        </div>
      ) : null}

      {state === "supplier_ordered" ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input value={carrier} onChange={(event) => setCarrier(event.target.value.slice(0, 80))} placeholder="Carrier" className="min-h-11 rounded-xl border border-card-border bg-background px-3 text-sm" />
          <input value={tracking} onChange={(event) => setTracking(event.target.value.slice(0, 120))} placeholder="Tracking number" className="min-h-11 rounded-xl border border-card-border bg-background px-3 text-sm" />
          <button disabled={busy || carrier.trim().length < 2 || tracking.trim().length < 2} onClick={() => void act({ action: "MARK_SHIPPED", carrier, trackingNumber: tracking })} className="min-h-11 rounded-xl bg-forest px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Mark shipped</button>
        </div>
      ) : null}

      {state === "shipped" ? (
        <button disabled={busy} onClick={() => void act({ action: "MARK_DELIVERED" })} className="mt-4 min-h-11 rounded-xl bg-forest px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Mark delivered</button>
      ) : null}

      {state === "hold" ? (
        <button disabled={busy} onClick={() => void act({ action: "RESUME_SOURCING" })} className="mt-4 min-h-11 rounded-xl border border-card-border px-4 py-2.5 text-sm font-bold text-forest">Resume sourcing</button>
      ) : null}

      {state && ["awaiting_sourcing", "sourcing", "supplier_ordered"].includes(state) ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input value={holdReason} onChange={(event) => setHoldReason(event.target.value.slice(0, 240))} placeholder="Hold reason" className="min-h-11 flex-1 rounded-xl border border-card-border bg-background px-3 text-sm" />
          <button disabled={busy || holdReason.trim().length < 3} onClick={() => void act({ action: "PLACE_HOLD", reason: holdReason })} className="min-h-11 rounded-xl border border-amber-300 px-4 py-2.5 text-sm font-bold text-amber-800 disabled:opacity-50 dark:text-amber-300">Place hold</button>
        </div>
      ) : null}

      {message ? <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{message}</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      {order.lastFulfillmentAt ? <p className="mt-3 text-xs text-forest-muted">Last operation: {order.lastFulfillmentAction} · {new Date(order.lastFulfillmentAt).toLocaleString()}</p> : null}
    </article>
  );
}

export function OwnerFulfillmentConsole() {
  const [orders, setOrders] = useState<CommerceOrder[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/commerce/orders?mode=actionable", { cache: "no-store" });
      const data = await readJson(response) as { items?: CommerceOrder[]; error?: string };
      if (!response.ok) {
        setError(data.error || "Could not load fulfillment queue.");
        return;
      }
      setOrders(data.items || []);
    } catch {
      setError("Could not reach the fulfillment queue.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="dn-card mt-8 p-5 sm:p-6" aria-labelledby="owner-fulfillment-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"><Truck className="h-3.5 w-3.5" /> Owner fulfillment</div>
          <h2 id="owner-fulfillment-title" className="mt-3 font-display text-2xl font-semibold text-forest-ink">Paid order sourcing &amp; fulfillment</h2>
          <p className="mt-2 text-sm leading-6 text-forest-muted">Payment status remains Stripe/webhook-owned. This queue separately records manual supplier purchasing, shipping, delivery, and holds with an audit trail.</p>
        </div>
        <button disabled={busy} onClick={() => void load()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-card-border px-4 text-sm font-bold text-forest disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Refresh</button>
      </div>

      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
        <ShieldAlert className="mr-1 inline h-4 w-4" /> Supplier purchasing is manual. Never mark an item ordered until the external supplier purchase actually succeeded and you have the supplier reference.
      </div>

      {error ? <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      {!busy && !error && orders.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-card-border p-6 text-center text-sm text-forest-muted"><PackageCheck className="mx-auto mb-2 h-6 w-6" /> No paid orders are waiting for fulfillment.</div>
      ) : null}
      <div className="mt-5 space-y-4">
        {orders.map((order) => <OrderCard key={order.id} order={order} reload={load} />)}
      </div>
    </section>
  );
}
