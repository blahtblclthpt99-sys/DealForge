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
  { href: "/search", label: "Search" },
  { href: "/deals", label: "Deals" },
];

export function Header({
  user,
}: {
  user: { name: string; role: string } | null;
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
    <header className="sticky top-0 z-50 border-b border-card-border/80 bg-background/90 backdrop-blur-md">
      <div className="dn-container flex h-16 items-center gap-3 md:gap-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5"
          onClick={() => setMenuPath(null)}
          aria-label="DealForge home"
        >
          <Image
            src="/dealforge-logo.png"
            alt="DealForge"
            width={44}
            height={44}
            className="h-10 w-10 rounded-xl object-cover shadow-sm"
            priority
          />
          <span className="font-display text-xl font-semibold tracking-tight text-forest-ink">
            Deal<span className="text-[#F97316]">Forge</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                pathname === item.href
                  ? "bg-forest/10 text-forest"
                  : "text-forest-muted hover:bg-forest/5 hover:text-forest-ink",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <form onSubmit={onSearch} className="ml-auto hidden max-w-md flex-1 md:flex">
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-forest-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search deals & products…"
              className="w-full rounded-full border border-card-border bg-card py-2 pl-10 pr-4 text-sm outline-none ring-forest focus:ring-2"
            />
          </div>
        </form>

        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <button
            type="button"
            onClick={toggle}
            aria-label="Toggle dark mode"
            className="rounded-lg p-2 text-forest-muted hover:bg-forest/10 hover:text-forest"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <Link
            href="/dashboard/wishlist"
            className="rounded-lg p-2 text-forest-muted hover:bg-forest/10 hover:text-forest"
            aria-label="Wishlist"
          >
            <Heart className="h-4 w-4" />
          </Link>
          {user ? (
            <>
              {user.role === "admin" && (
                <Link
                  href="/admin"
                  className="hidden rounded-lg p-2 text-forest-muted hover:bg-forest/10 hover:text-forest sm:inline-flex"
                  aria-label="Admin"
                >
                  <LayoutDashboard className="h-4 w-4" />
                </Link>
              )}
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-full bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-dark"
              >
                <User className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{user.name.split(" ")[0]}</span>
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/register"
                className="hidden rounded-full border border-card-border px-3 py-1.5 text-sm font-medium text-forest hover:bg-forest/5 sm:inline-flex"
              >
                Register
              </Link>
              <Link
                href="/login"
                className="rounded-full bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-dark"
              >
                Sign in
              </Link>
            </>
          )}
          <button
            type="button"
            className="rounded-lg p-2 text-forest-muted md:hidden"
            onClick={() => setMenuPath(open ? null : pathname)}
            aria-label="Menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-card-border bg-background px-4 py-4 md:hidden">
          <form onSubmit={onSearch} className="mb-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-xl border border-card-border bg-card px-3 py-2 text-sm outline-none ring-forest focus:ring-2"
            />
          </form>
          <div className="flex flex-col gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuPath(null)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-forest-ink hover:bg-forest/10"
              >
                {item.label}
              </Link>
            ))}
            {!user && (
              <>
                <Link
                  href="/register"
                  onClick={() => setMenuPath(null)}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-forest hover:bg-forest/10"
                >
                  Register
                </Link>
                <Link
                  href="/login"
                  onClick={() => setMenuPath(null)}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-forest-ink hover:bg-forest/10"
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
