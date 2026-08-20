"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  Heart,
  LayoutDashboard,
  Menu,
  Moon,
  Search,
  Sun,
  User,
  X,
} from "lucide-react";
import { useTheme } from "./theme-provider";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/categories", label: "Categories" },
  { href: "/deals", label: "Deal Watch" },
  { href: "/search", label: "Search" },
];

export function Header({
  user,
}: {
  user: { name: string; role: string; email?: string } | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const open = menuPath === pathname;

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    setMenuPath(null);
    router.push(query ? `/search?q=${encodeURIComponent(query)}` : "/search");
  }

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#0b0b0c]/95 text-white shadow-[0_8px_30px_rgba(0,0,0,.2)] backdrop-blur-xl">
      <div className="dn-container flex h-[68px] items-center gap-3 md:gap-6">
        <Link
          href="/"
          className="group flex shrink-0 items-center gap-2.5"
          onClick={() => setMenuPath(null)}
          aria-label="DealForge home"
        >
          <span className="relative">
            <span className="absolute inset-0 rounded-xl bg-[#F97316]/25 blur-md transition group-hover:bg-[#F97316]/35" />
            <Image
              src="/dealforge-logo.png"
              alt="DealForge"
              width={44}
              height={44}
              className="relative h-10 w-10 rounded-xl object-cover ring-1 ring-white/10"
              priority
            />
          </span>
          <span className="font-display text-xl font-semibold tracking-tight text-white">
            Deal<span className="text-[#F97316]">Forge</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
                pathname === item.href
                  ? "bg-[#F97316] text-white"
                  : "text-white/65 hover:bg-white/7 hover:text-white",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <form onSubmit={onSearch} className="ml-auto hidden max-w-md flex-1 md:flex">
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search products & brands…"
              className="w-full rounded-full border border-white/10 bg-white/[0.07] py-2.5 pl-10 pr-4 text-sm text-white outline-none placeholder:text-white/35 focus:border-[#F97316]/70 focus:ring-2 focus:ring-[#F97316]/20"
            />
          </div>
        </form>

        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <button
            type="button"
            onClick={toggle}
            aria-label="Toggle color theme"
            className="rounded-lg p-2 text-white/55 transition hover:bg-white/10 hover:text-[#FB923C]"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <Link
            href="/dashboard/wishlist"
            className="rounded-lg p-2 text-white/55 transition hover:bg-white/10 hover:text-[#FB923C]"
            aria-label="Wishlist"
          >
            <Heart className="h-4 w-4" />
          </Link>
          {user ? (
            <>
              {user.role === "admin" && (
                <Link
                  href="/admin"
                  className="hidden rounded-lg p-2 text-white/55 transition hover:bg-white/10 hover:text-[#FB923C] sm:inline-flex"
                  aria-label="Admin"
                >
                  <LayoutDashboard className="h-4 w-4" />
                </Link>
              )}
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-full bg-[#F97316] px-3.5 py-2 text-sm font-bold text-white shadow-[0_6px_18px_rgba(249,115,22,.25)] transition hover:bg-[#EA580C]"
              >
                <User className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{user.name.split(" ")[0]}</span>
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/register"
                className="hidden rounded-full border border-white/15 px-3.5 py-2 text-sm font-semibold text-white/80 transition hover:border-[#F97316]/50 hover:text-white sm:inline-flex"
              >
                Register
              </Link>
              <Link
                href="/login"
                className="rounded-full bg-[#F97316] px-3.5 py-2 text-sm font-bold text-white shadow-[0_6px_18px_rgba(249,115,22,.22)] transition hover:bg-[#EA580C]"
              >
                Sign in
              </Link>
            </>
          )}
          <button
            type="button"
            className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 md:hidden"
            onClick={() => setMenuPath(open ? null : pathname)}
            aria-label="Menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-white/10 bg-[#0f0f10] px-4 py-4 md:hidden">
          <form onSubmit={onSearch} className="mb-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search products…"
              className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-[#F97316]/60 focus:ring-2 focus:ring-[#F97316]/20"
            />
          </form>
          <div className="flex flex-col gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuPath(null)}
                className="rounded-lg px-3 py-2.5 text-sm font-semibold text-white/80 hover:bg-white/8 hover:text-white"
              >
                {item.label}
              </Link>
            ))}
            {!user && (
              <>
                <Link
                  href="/register"
                  onClick={() => setMenuPath(null)}
                  className="rounded-lg px-3 py-2.5 text-sm font-semibold text-[#FB923C] hover:bg-white/8"
                >
                  Register
                </Link>
                <Link
                  href="/login"
                  onClick={() => setMenuPath(null)}
                  className="rounded-lg px-3 py-2.5 text-sm font-semibold text-white/80 hover:bg-white/8"
                >
                  Sign in
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
