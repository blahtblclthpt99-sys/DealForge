"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowRight, BellRing, Heart, ShieldCheck } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
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
        body: JSON.stringify({ action: "register", name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "We couldn’t create your account. Review your details and try again.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("DealForge couldn’t reach the account service. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="dn-container py-10 sm:py-14 lg:py-18">
      <div className="mx-auto grid max-w-5xl items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,.72fr)]">
        <section className="dn-hero relative overflow-hidden rounded-[1.5rem] border border-white/10 p-7 sm:p-9 lg:p-10">
          <div className="relative z-10 max-w-xl">
            <div className="dn-eyebrow border-white/12 bg-white/[0.06] text-[#FB923C]">
              <ShieldCheck className="h-3.5 w-3.5" /> Free DealForge account
            </div>
            <h1 className="mt-5 font-display text-4xl font-semibold leading-tight tracking-[-0.035em] text-white sm:text-5xl">
              Make DealForge work around what you’re shopping for.
            </h1>
            <p className="mt-4 max-w-lg text-sm leading-7 text-white/62 sm:text-base">
              Save products, keep useful searches close, and manage alerts without changing how retailer checkout works.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.055] p-4">
                <Heart className="h-5 w-5 text-[#FB923C]" />
                <p className="mt-3 text-sm font-bold text-white">Build a wishlist</p>
                <p className="mt-1 text-xs leading-5 text-white/48">Keep interesting products together.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.055] p-4">
                <BellRing className="h-5 w-5 text-[#FB923C]" />
                <p className="mt-3 text-sm font-bold text-white">Manage alerts</p>
                <p className="mt-1 text-xs leading-5 text-white/48">Track the items you care about.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.055] p-4">
                <ShieldCheck className="h-5 w-5 text-[#FB923C]" />
                <p className="mt-3 text-sm font-bold text-white">Retailer checkout</p>
                <p className="mt-1 text-xs leading-5 text-white/48">Final terms stay with the retailer.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="flex flex-col justify-center">
          <div className="mb-5">
            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-forest">Get started</p>
            <h2 className="mt-1 font-display text-3xl font-semibold tracking-tight text-forest-ink">Create account</h2>
            <p className="mt-2 text-sm leading-6 text-forest-muted">A few details and your personal DealForge workspace is ready.</p>
          </div>

          <form onSubmit={onSubmit} className="dn-card space-y-5 p-5 sm:p-7" aria-busy={loading}>
            <div>
              <label htmlFor="register-name" className="mb-2 block text-sm font-bold text-forest-ink">Name</label>
              <input
                id="register-name"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="dn-input"
                placeholder="Your name"
              />
            </div>

            <div>
              <label htmlFor="register-email" className="mb-2 block text-sm font-bold text-forest-ink">Email address</label>
              <input
                id="register-email"
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
              <label htmlFor="register-password" className="mb-2 block text-sm font-bold text-forest-ink">Password</label>
              <input
                id="register-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="dn-input"
                placeholder="At least 8 characters"
                aria-describedby="password-help"
              />
              <p id="password-help" className="mt-2 text-xs leading-5 text-forest-muted">Use at least 8 characters. A unique password is recommended.</p>
            </div>

            {error ? <p role="alert" className="dn-status-error">{error}</p> : null}

            <button type="submit" disabled={loading} className="dn-button-primary w-full">
              {loading ? "Creating account…" : "Create account"}
              {!loading ? <ArrowRight className="h-4 w-4" /> : null}
            </button>

            <p className="text-center text-sm leading-6 text-forest-muted">
              Already have an account?{" "}
              <Link href="/login" className="font-bold text-forest hover:underline">Sign in</Link>
            </p>
          </form>
        </section>
      </div>
    </div>
  );
}
