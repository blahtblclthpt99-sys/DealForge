"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type CandidateRow = {
  id: string;
  asin: string;
  title: string | null;
  state: string;
  score: number;
  category: string | null;
  rejectionReason: string | null;
};

type SourceType = "owner_asin" | "owner_special_link" | "public_reference";

async function engineAction(body: Record<string, unknown>) {
  const res = await fetch("/api/admin/product-engine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Product Engine action failed");
  return payload;
}

export function ProductEngineControls({ paused, candidates }: { paused: boolean; candidates: CandidateRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [asin, setAsin] = useState("");
  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [specialLink, setSpecialLink] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("owner_asin");
  const [scout, setScout] = useState<"scout-a" | "scout-b">("scout-a");

  async function act(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await engineAction(body);
      setMessage(success);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function intake(e: React.FormEvent) {
    e.preventDefault();
    await act({
      action: "intake",
      asin,
      title: title || undefined,
      brand: brand || undefined,
      category: category || undefined,
      ownerSpecialLink: sourceType === "owner_special_link" ? specialLink || undefined : undefined,
      sourceUrl: sourceType === "public_reference" ? sourceUrl || undefined : undefined,
      sourceType,
      scout,
    }, "Candidate accepted into the queue.");
    setAsin("");
    setTitle("");
    setBrand("");
    setCategory("");
    setSpecialLink("");
    setSourceUrl("");
  }

  return (
    <>
      <section className="dn-card mt-8 min-w-0 overflow-hidden p-5">
        <div className="flex flex-wrap gap-3">
          <button disabled={busy} onClick={() => act({ action: "run" }, "Product Engine run completed.")} className="rounded-xl bg-forest px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Run Discovery</button>
          {paused ? (
            <button disabled={busy} onClick={() => act({ action: "resume" }, "Product Engine resumed.")} className="rounded-xl border border-card-border px-4 py-2 text-sm font-semibold text-forest-ink disabled:opacity-50">Resume</button>
          ) : (
            <button disabled={busy} onClick={() => act({ action: "pause" }, "Product Engine paused.")} className="rounded-xl border border-card-border px-4 py-2 text-sm font-semibold text-forest-ink disabled:opacity-50">Pause</button>
          )}
          <a href="#review-queue" className="rounded-xl border border-card-border px-4 py-2 text-sm font-semibold text-forest-ink">Review</a>
        </div>
        <p className="mt-3 text-xs text-forest-muted">Discovery means processing candidates supplied by the owner or recorded from permissible public references. It does not crawl or scrape Amazon.</p>
        {message ? <p role="status" className="mt-3 break-words text-sm text-forest-muted">{message}</p> : null}
      </section>

      <section className="dn-card mt-6 min-w-0 overflow-hidden p-5">
        <h2 className="font-display text-xl font-semibold text-forest-ink">Candidate intake</h2>
        <p className="mt-1 text-sm text-forest-muted">Add an ASIN, an existing Amazon Special Link, or a permissible public reference. DealForge never fetches Amazon HTML from this form.</p>
        <form onSubmit={intake} className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
          <select value={sourceType} onChange={(e) => setSourceType(e.target.value as SourceType)} className="min-w-0 rounded-xl border border-card-border bg-card px-3 py-2 text-sm">
            <option value="owner_asin">Owner-supplied ASIN</option>
            <option value="owner_special_link">Owner Amazon Special Link</option>
            <option value="public_reference">Permissible public reference</option>
          </select>
          <select value={scout} onChange={(e) => setScout(e.target.value as "scout-a" | "scout-b")} className="min-w-0 rounded-xl border border-card-border bg-card px-3 py-2 text-sm"><option value="scout-a">Scout A</option><option value="scout-b">Scout B</option></select>
          <input required value={asin} onChange={(e) => setAsin(e.target.value)} placeholder="ASIN (10 characters)" maxLength={20} className="min-w-0 rounded-xl border border-card-border bg-card px-3 py-2 text-sm" />
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Product title" maxLength={500} className="min-w-0 rounded-xl border border-card-border bg-card px-3 py-2 text-sm" />
          <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand" maxLength={160} className="min-w-0 rounded-xl border border-card-border bg-card px-3 py-2 text-sm" />
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" maxLength={100} className="min-w-0 rounded-xl border border-card-border bg-card px-3 py-2 text-sm" />
          {sourceType === "owner_special_link" ? <input required value={specialLink} onChange={(e) => setSpecialLink(e.target.value)} placeholder="Amazon Special Link" maxLength={2000} className="min-w-0 rounded-xl border border-card-border bg-card px-3 py-2 text-sm sm:col-span-2" /> : null}
          {sourceType === "public_reference" ? <input required value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="Public source URL" maxLength={2000} className="min-w-0 rounded-xl border border-card-border bg-card px-3 py-2 text-sm sm:col-span-2" /> : null}
          <button disabled={busy} type="submit" className="rounded-xl bg-forest px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2">Add candidate</button>
        </form>
      </section>

      <section id="review-queue" className="dn-card mt-6 min-w-0 scroll-mt-6 overflow-hidden p-5">
        <h2 className="font-display text-xl font-semibold text-forest-ink">Review queue</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead><tr className="border-b border-card-border text-forest-muted"><th className="p-2">ASIN</th><th className="p-2">Title</th><th className="p-2">State</th><th className="p-2">Score</th><th className="p-2">Category</th><th className="p-2">Reason</th><th className="p-2">Actions</th></tr></thead>
            <tbody>
              {candidates.map((candidate) => (
                <tr key={candidate.id} className="border-b border-card-border/70 align-top">
                  <td className="p-2 font-mono">{candidate.asin}</td>
                  <td className="max-w-[16rem] break-words p-2">{candidate.title ?? "—"}</td>
                  <td className="p-2">{candidate.state}</td>
                  <td className="p-2">{candidate.score.toFixed(0)}</td>
                  <td className="p-2">{candidate.category ?? "—"}</td>
                  <td className="max-w-[12rem] break-words p-2">{candidate.rejectionReason ?? "—"}</td>
                  <td className="p-2"><div className="flex gap-2">{["classified", "approved"].includes(candidate.state) ? <button disabled={busy} onClick={() => act({ action: "publish", candidateId: candidate.id }, "Candidate published.")} className="underline">Publish</button> : null}{["dead_letter", "rejected"].includes(candidate.state) ? <button disabled={busy} onClick={() => act({ action: "retry", candidateId: candidate.id }, "Candidate queued for retry.")} className="underline">Retry</button> : null}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
