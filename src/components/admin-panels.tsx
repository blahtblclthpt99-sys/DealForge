"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Provider = {
  id: string;
  provider: string;
  displayName: string;
  trackingId: string;
  enabled: boolean;
  lastSyncStatus: string | null;
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
  connectors: { id: string; displayName: string }[];
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

  async function toggleProvider(id: string, enabled: boolean) {
    setBusy(id);
    await fetch("/api/admin", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "provider", id, enabled }),
    });
    setBusy(null);
    router.refresh();
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
          Modular connectors registered: {connectors.map((c) => c.displayName).join(", ")}.
        </p>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-card-border bg-card">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-card-border text-forest-muted">
              <tr>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Tracking ID</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Enabled</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id} className="border-b border-card-border/70">
                  <td className="px-4 py-3 font-medium text-forest-ink">{p.displayName}</td>
                  <td className="px-4 py-3 text-forest-muted">{p.trackingId || "—"}</td>
                  <td className="px-4 py-3 text-forest-muted">{p.lastSyncStatus || "—"}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      disabled={busy === p.id}
                      onClick={() => toggleProvider(p.id, !p.enabled)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        p.enabled ? "bg-forest text-white" : "bg-forest/10 text-forest"
                      }`}
                    >
                      {p.enabled ? "On" : "Off"}
                    </button>
                  </td>
                </tr>
              ))}
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
              <p className="text-sm text-forest-muted">No PA-API calls yet — seed data is local.</p>
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
                <th className="px-4 py-3">Price</th>
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
