"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { ArrowRight, Heart, Search, ShieldCheck } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "We couldn’t sign you in. Check your details and try again.");
        return;
      }
      const next = searchParams.get("next") || (data.user?.role === "admin" ? "/admin" : "/dashboard");
      router.push(next);
      router.refresh();
    } catch {
      setError("DealForge couldn’t reach the sign-in service. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="dn-card space-y-5 p-5 sm:p-7" aria-busy={loading}>
      <div>
        <label htmlFor="login-email" className="mb-2 block text-sm font-bold text-forest-ink">
          Email address
        </label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="dn-input"
          placeholder="you@example.com"
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <label htmlFor="login-password" className="text-sm font-bold text-forest-ink">
            Password
          </label>
        </div>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="dn-input"
          placeholder="Enter your password"
        />
      </div>

      {error ? (
        <p role="alert" className="dn-status-error">
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={loading} className="dn-button-primary w-full">
        {loading ? "Signing in…" : "Sign in"}
        {!loading ? <ArrowRight className="h-4 w-4" /> : null}
      </button>

      <p className="text-center text-sm leading-6 text-forest-muted">
        New to DealForge?{" "}
        <Link href="/register" className="font-bold text-forest hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="dn-container py-10 sm:py-14 lg:py-18">
      <div className="mx-auto grid max-w-5xl items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,.72fr)]">
        <section className="dn-hero relative overflow-hidden rounded-[1.5rem] border border-white/10 p-7 sm:p-9 lg:p-10">
          <div className="relative z-10 max-w-xl">
            <div className="dn-eyebrow border-white/12 bg-white/[0.06] text-[#FB923C]">
              <ShieldCheck className="h-3.5 w-3.5" /> Secure account access
            </div>
            <h1 className="mt-5 font-display text-4xl font-semibold leading-tight tracking-[-0.035em] text-white sm:text-5xl">
              Welcome back to your deal workspace.
            </h1>
            <p className="mt-4 max-w-lg text-sm leading-7 text-white/62 sm:text-base">
              Sign in to pick up where you left off with wishlists, saved searches, price alerts, and your DealForge account.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.055] p-4">
                <Heart className="h-5 w-5 text-[#FB923C]" />
                <p className="mt-3 text-sm font-bold text-white">Saved items</p>
                <p className="mt-1 text-xs leading-5 text-white/48">Keep products easy to revisit.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.055] p-4">
                <Search className="h-5 w-5 text-[#FB923C]" />
                <p className="mt-3 text-sm font-bold text-white">Saved searches</p>
                <p className="mt-1 text-xs leading-5 text-white/48">Return to the products that matter.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.055] p-4">
                <ShieldCheck className="h-5 w-5 text-[#FB923C]" />
                <p className="mt-3 text-sm font-bold text-white">Price clarity</p>
                <p className="mt-1 text-xs leading-5 text-white/48">Verify final terms with the retailer.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="flex flex-col justify-center">
          <div className="mb-5">
            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-forest">Account</p>
            <h2 className="mt-1 font-display text-3xl font-semibold tracking-tight text-forest-ink">Sign in</h2>
            <p className="mt-2 text-sm leading-6 text-forest-muted">Use the email and password associated with your account.</p>
          </div>
          <Suspense fallback={<div className="skeleton h-80 rounded-2xl" />}>
            <LoginForm />
          </Suspense>
        </section>
      </div>
    </div>
  );
}
