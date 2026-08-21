"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Provider = {
  id: string;
  provider: string;
  displayName: string;
  trackingId: string;
  enabled: boolean;
  lastSyncStatus: string | null;
};

type ConnectorReadiness = {
  id: string;
  displayName: string;
  trackedLinks: boolean;
  productDataApi: boolean;
  status: "ready" | "partial" | "pending";
  note: string;
};

export function AdminPanels({
  providers,
  connectors,
  importJobs,
  logs,
  apiUsage,
  users,
  products,
  cache,
}: {
  providers: Provider[];
  connectors: ConnectorReadiness[];
  importJobs: {
    id: string;
    provider: string;
    status: string;
    itemsTotal: number;
    itemsSuccess: number;
    itemsFailed: number;
    createdAt: string;
  }[];
  logs: { id: string; level: string; source: string; message: string; createdAt: string }[];
  apiUsage: { id: string; provider: string; endpoint: string; status: number; latencyMs: number; createdAt: string }[];
  users: { id: string; name: string; email: string; role: string; createdAt: string }[];
  products: {
    id: string;
    title: string;
    price: number;
    originalPrice: number;
    isFeatured: boolean;
    isFlashDeal: boolean;
    availability: string;
    clickCount: number;
    asin: string | null;
  }[];
  cache: { backend: string; memoryKeys: number; dbKeys: number; redisConnected: boolean };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const readinessById = useMemo(
    () => new Map(connectors.map((connector) => [connector.id, connector])),
    [connectors],
  );

  async function toggleProvider(id: string, enabled: boolean) {
    setBusy(id);
    setProviderError(null);
    try {
      const response = await fetch("/api/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "provider", id, enabled }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setProviderError(body.error || "Provider update failed");
        return;
      }
      router.refresh();
    } catch {
      setProviderError("Provider update failed");
    } finally {
      setBusy(null);
    }
  }

  async function setRole(id: string, role: string) {
    await fetch("/api/admin", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "user-role", id, role }),
    });
    router.refresh();
  }

  async function toggleProductFlag(id: string, field: "isFeatured" | "isFlashDeal", value: boolean) {
    const product = products.find((p) => p.id === id);
    if (!product) return;
    await fetch("/api/admin", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "product",
        id,
        price: product.price,
        originalPrice: product.originalPrice,
        availability: product.availability,
        isFeatured: field === "isFeatured" ? value : product.isFeatured,
        isFlashDeal: field === "isFlashDeal" ? value : product.isFlashDeal,
      }),
    });
    router.refresh();
  }

  return (
    <div className="mt-10 space-y-10">
      <section>
        <h2 className="font-display text-2xl font-semibold text-forest-ink">Affiliate networks</h2>
        <p className="mt-1 text-sm text-forest-muted">
          A provider is revenue-ready only when both the database setting and the runtime tracking configuration agree.
        </p>
        {providerError ? (
          <p className="mt-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/20 dark:text-red-300">
            {providerError}
          </p>
        ) : null}
        <div className="mt-4 overflow-x-auto rounded-2xl border border-card-border bg-card">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-card-border text-forest-muted">
              <tr>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Tracking</th>
                <th className="px-4 py-3">Product data</th>
                <th className="px-4 py-3">DB status</th>
                <th className="px-4 py-3">Runtime</th>
                <th className="px-4 py-3">Enabled</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => {
                const runtime = readinessById.get(provider.provider);
                const canEnable = Boolean(runtime?.trackedLinks);
                const runtimeStatus = runtime?.status ?? "pending";
                return (
                  <tr key={provider.id} className="border-b border-card-border/70 align-top">
                    <td className="px-4 py-3">
                      <p className="font-medium text-forest-ink">{provider.displayName}</p>
                      <p className="mt-1 max-w-xs text-xs leading-relaxed text-forest-muted">
                        {runtime?.note || "No runtime readiness information available."}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${canEnable ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"}`}>
                        {canEnable ? "Ready" : "Missing"}
                      </span>
                      {provider.trackingId ? (
                        <p className="mt-2 max-w-[12rem] truncate text-[10px] text-forest-muted" title={provider.trackingId}>
                          DB ID: {provider.trackingId}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${runtime?.productDataApi ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-forest/10 text-forest-muted"}`}>
                        {runtime?.productDataApi ? "Ready" : "Pending"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-forest-muted">{provider.lastSyncStatus || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${runtimeStatus === "ready" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : runtimeStatus === "partial" ? "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"}`}>
                        {runtimeStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={busy === provider.id || (!provider.enabled && !canEnable)}
                        onClick={() => toggleProvider(provider.id, !provider.enabled)}
                        title={!provider.enabled && !canEnable ? "Configure tracked-link credentials before enabling this provider." : undefined}
                        className={`rounded-full px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${
                          provider.enabled ? "bg-forest text-white" : "bg-forest/10 text-forest"
                        }`}
                      >
                        {provider.enabled ? "On" : "Off"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-xl font-semibold text-forest-ink">Product import status</h2>
          <div className="mt-3 space-y-2">
            {importJobs.map((j) => (
              <div key={j.id} className="dn-card p-4 text-sm">
                <p className="font-medium text-forest-ink">
                  {j.provider} · {j.status}
                </p>
                <p className="text-forest-muted">
                  {j.itemsSuccess}/{j.itemsTotal} ok · {j.itemsFailed} failed ·{" "}
                  {new Date(j.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h2 className="font-display text-xl font-semibold text-forest-ink">Cache status</h2>
          <div className="dn-card mt-3 space-y-2 p-4 text-sm">
            <p>
              Backend: <strong>{cache.backend}</strong>
            </p>
            <p>Redis connected: {cache.redisConnected ? "yes" : "no"}</p>
            <p>Memory keys: {cache.memoryKeys}</p>
            <p>DB keys: {cache.dbKeys}</p>
          </div>
          <h2 className="mt-6 font-display text-xl font-semibold text-forest-ink">API usage</h2>
          <div className="mt-3 space-y-2">
            {apiUsage.length === 0 && (
              <p className="text-sm text-forest-muted">No retailer API usage has been recorded yet.</p>
            )}
            {apiUsage.map((a) => (
              <div key={a.id} className="dn-card p-3 text-xs text-forest-muted">
                {a.provider} {a.endpoint} · {a.status} · {a.latencyMs}ms
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <h2 className="font-display text-2xl font-semibold text-forest-ink">System logs</h2>
        <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
          {logs.map((l) => (
            <div key={l.id} className="dn-card p-3 text-sm">
              <span className="mr-2 rounded bg-forest/10 px-2 py-0.5 text-xs font-semibold uppercase text-forest">
                {l.level}
              </span>
              <span className="text-forest-muted">{l.source}</span>
              <p className="mt-1 text-forest-ink">{l.message}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-display text-2xl font-semibold text-forest-ink">User management</h2>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-card-border bg-card">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-card-border text-forest-muted">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-card-border/70">
                  <td className="px-4 py-3">{u.name}</td>
                  <td className="px-4 py-3 text-forest-muted">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      onChange={(e) => setRole(u.id, e.target.value)}
                      className="rounded-lg border border-card-border bg-background px-2 py-1"
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="font-display text-2xl font-semibold text-forest-ink">Product database</h2>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-card-border bg-card">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-card-border text-forest-muted">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">ASIN</th>
                <th className="px-4 py-3">Recorded price</th>
                <th className="px-4 py-3">Clicks</th>
                <th className="px-4 py-3">Flags</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b border-card-border/70">
                  <td className="max-w-xs truncate px-4 py-3 font-medium">{p.title}</td>
                  <td className="px-4 py-3 text-forest-muted">{p.asin}</td>
                  <td className="px-4 py-3">${p.price.toFixed(2)}</td>
                  <td className="px-4 py-3">{p.clickCount}</td>
                  <td className="px-4 py-3 space-x-2">
                    <button
                      type="button"
                      onClick={() => toggleProductFlag(p.id, "isFeatured", !p.isFeatured)}
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        p.isFeatured ? "bg-forest text-white" : "bg-forest/10 text-forest"
                      }`}
                    >
                      Featured
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleProductFlag(p.id, "isFlashDeal", !p.isFlashDeal)}
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        p.isFlashDeal ? "bg-forest text-white" : "bg-forest/10 text-forest"
                      }`}
                    >
                      Flash
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
