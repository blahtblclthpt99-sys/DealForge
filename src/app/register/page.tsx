"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "register", name, email, password }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "Registration failed");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="dn-container py-12">
      <h1 className="text-center font-display text-4xl font-semibold text-forest-ink">Join DealForge</h1>
      <p className="mt-2 text-center text-forest-muted">Save deals, track prices, and personalize discovery.</p>
      <form onSubmit={onSubmit} className="dn-card mx-auto mt-8 max-w-md space-y-4 p-6">
        <label className="block text-sm">
          <span className="mb-1 block text-forest-muted">Name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-card-border bg-background px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-forest-muted">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-card-border bg-background px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-forest-muted">Password (min 8)</span>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-card-border bg-background px-3 py-2"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-full bg-forest py-2.5 text-sm font-semibold text-white hover:bg-forest-dark"
        >
          {loading ? "Creating…" : "Create account"}
        </button>
        <p className="text-center text-sm text-forest-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-forest hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
