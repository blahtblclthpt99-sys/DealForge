"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("demo@dealforge.com");
  const [password, setPassword] = useState("DemoUser123!");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", email, password }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "Login failed");
      return;
    }
    const next = searchParams.get("next") || (data.user?.role === "admin" ? "/admin" : "/dashboard");
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="dn-card mx-auto mt-8 max-w-md space-y-4 p-6">
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
        <span className="mb-1 block text-forest-muted">Password</span>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-card-border bg-background px-3 py-2"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-full bg-forest py-2.5 text-sm font-semibold text-white hover:bg-forest-dark disabled:opacity-60"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-center text-sm text-forest-muted">
        No account?{" "}
        <Link href="/register" className="font-medium text-forest hover:underline">
          Create one
        </Link>
      </p>
      <p className="text-center text-xs text-forest-muted">
        Demo: demo@dealforge.com / DemoUser123! · Admin: admin@dealforge.com
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="dn-container py-12">
      <h1 className="text-center font-display text-4xl font-semibold text-forest-ink">Welcome back</h1>
      <p className="mt-2 text-center text-forest-muted">Sign in to manage wishlists, alerts, and saved searches.</p>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
