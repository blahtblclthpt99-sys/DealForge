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

const MAX_QUERY_LENGTH = 120;
const NAV = [
  { href: "/", label: "Home" },
  { href: "/categories", label: "Categories" },
  { href: "/deals", label: "Deal Watch" },
  { href: "/search", label: "Product Finder" },
];

function cleanQuery(value: string) {
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").slice(0, MAX_QUERY_LENGTH);
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

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

  function closeMenu() {
    setMenuPath(null);
  }

  function onSearch(event: React.FormEvent) {
    event.preventDefault();
    const query = cleanQuery(q).trim();
    closeMenu();
    router.push(query ? `/search?q=${encodeURIComponent(query)}` : "/search");
  }

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#09090a]/92 text-white shadow-[0_8px_32px_rgba(0,0,0,.22)] backdrop-blur-xl supports-[backdrop-filter]:bg-[#09090a]/85">
      <div className="dn-container flex min-h-[72px] items-center gap-2 sm:gap-3 lg:gap-5">
        <Link
          href="/"
          className="group flex min-h-11 shrink-0 items-center gap-2.5 rounded-xl pr-1"
          onClick={closeMenu}
          aria-label="DealForge home"
        >
          <span className="relative">
            <span className="absolute inset-0 rounded-xl bg-[#F97316]/25 blur-md transition group-hover:bg-[#F97316]/38" />
            <Image
              src="/dealforge-logo.png"
              alt=""
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

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary navigation">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold transition-colors",
                  active
                    ? "bg-white/[0.09] text-white ring-1 ring-white/10"
                    : "text-white/62 hover:bg-white/[0.06] hover:text-white",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <form onSubmit={onSearch} className="ml-auto hidden max-w-md flex-1 md:flex" role="search">
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/42" />
            <input
              value={q}
              onChange={(event) => setQ(cleanQuery(event.target.value))}
              maxLength={MAX_QUERY_LENGTH}
              type="search"
              autoComplete="off"
              aria-label="Search DealForge products"
              placeholder="Search products and brands…"
              className="min-h-11 w-full rounded-full border border-white/10 bg-white/[0.065] py-2 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-white/34 hover:border-white/16 focus:border-[#F97316]/70 focus:ring-4 focus:ring-[#F97316]/12"
            />
          </div>
        </form>

        <div className="ml-auto flex items-center gap-0.5 md:ml-0 sm:gap-1">
          <button
            type="button"
            onClick={toggle}
            aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-white/58 transition hover:bg-white/[0.08] hover:text-[#FB923C]"
          >
            {theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          </button>
          <Link
            href="/dashboard/wishlist"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-white/58 transition hover:bg-white/[0.08] hover:text-[#FB923C]"
            aria-label="Wishlist"
          >
            <Heart className="h-[18px] w-[18px]" />
          </Link>

          {user ? (
            <>
              {user.role === "admin" ? (
                <Link
                  href="/admin"
                  className="hidden h-11 w-11 items-center justify-center rounded-xl text-white/58 transition hover:bg-white/[0.08] hover:text-[#FB923C] sm:inline-flex"
                  aria-label="Admin dashboard"
                >
                  <LayoutDashboard className="h-[18px] w-[18px]" />
                </Link>
              ) : null}
              <Link
                href="/dashboard"
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#F97316] px-3.5 text-sm font-extrabold text-white shadow-[0_7px_20px_rgba(249,115,22,.24)] transition hover:-translate-y-0.5 hover:bg-[#EA580C]"
              >
                <User className="h-4 w-4" />
                <span className="hidden sm:inline">{user.name.split(" ")[0] || "Account"}</span>
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/register"
                className="hidden min-h-11 items-center rounded-full border border-white/14 px-4 text-sm font-semibold text-white/76 transition hover:border-[#F97316]/48 hover:bg-white/[0.04] hover:text-white xl:inline-flex"
              >
                Create account
              </Link>
              <Link
                href="/login"
                className="inline-flex min-h-11 items-center rounded-full bg-[#F97316] px-4 text-sm font-extrabold text-white shadow-[0_7px_20px_rgba(249,115,22,.22)] transition hover:-translate-y-0.5 hover:bg-[#EA580C]"
              >
                Sign in
              </Link>
            </>
          )}

          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-white/76 transition hover:bg-white/[0.08] lg:hidden"
            onClick={() => setMenuPath(open ? null : pathname)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-navigation"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open ? (
        <div id="mobile-navigation" className="border-t border-white/10 bg-[#0d0d0e] lg:hidden">
          <div className="dn-container py-4">
            <form onSubmit={onSearch} className="mb-4 md:hidden" role="search">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" />
                <input
                  value={q}
                  onChange={(event) => setQ(cleanQuery(event.target.value))}
                  maxLength={MAX_QUERY_LENGTH}
                  type="search"
                  autoComplete="off"
                  aria-label="Search DealForge products"
                  placeholder="What are you looking for?"
                  className="min-h-12 w-full rounded-xl border border-white/10 bg-white/[0.06] py-2.5 pl-10 pr-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-[#F97316]/60 focus:ring-4 focus:ring-[#F97316]/12"
                />
              </div>
            </form>

            <nav className="grid gap-1 sm:grid-cols-2" aria-label="Mobile navigation">
              {NAV.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={closeMenu}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-12 items-center rounded-xl px-3.5 text-sm font-semibold",
                      active ? "bg-[#F97316]/13 text-[#FB923C]" : "text-white/78 hover:bg-white/[0.07] hover:text-white",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}

              {user ? (
                <>
                  <Link href="/dashboard" onClick={closeMenu} className="flex min-h-12 items-center rounded-xl px-3.5 text-sm font-semibold text-white/78 hover:bg-white/[0.07] hover:text-white">
                    My dashboard
                  </Link>
                  {user.role === "admin" ? (
                    <Link href="/admin" onClick={closeMenu} className="flex min-h-12 items-center rounded-xl px-3.5 text-sm font-semibold text-[#FB923C] hover:bg-white/[0.07]">
                      Admin tools
                    </Link>
                  ) : null}
                </>
              ) : (
                <Link href="/register" onClick={closeMenu} className="flex min-h-12 items-center rounded-xl px-3.5 text-sm font-semibold text-[#FB923C] hover:bg-white/[0.07]">
                  Create account
                </Link>
              )}
            </nav>
          </div>
        </div>
      ) : null}
    </header>
  );
}
