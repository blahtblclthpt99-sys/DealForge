import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Bell,
  Clock,
  Heart,
  Search,
  Settings,
} from "lucide-react";
import { LogoutButton } from "@/components/logout-button";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseJson } from "@/lib/utils";

const LINKS = [
  { href: "/dashboard/wishlist", label: "Wishlist", icon: Heart, desc: "Products you saved for another look" },
  { href: "/dashboard/searches", label: "Saved searches", icon: Search, desc: "Return to useful product searches and filters" },
  { href: "/dashboard/recent", label: "Recently viewed", icon: Clock, desc: "Pick up where you left off" },
  { href: "/dashboard/alerts", label: "Price alerts", icon: Bell, desc: "Manage the products you want to track" },
  { href: "/dashboard/settings", label: "Account settings", icon: Settings, desc: "Profile and account preferences" },
];

export default async function DashboardPage() {
  const session = await readSession();
  if (!session) redirect("/login?next=/dashboard");

  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) redirect("/login");

  const wishlist = parseJson<string[]>(user.wishlist, []);
  const searches = parseJson<unknown[]>(user.savedSearches, []);
  const recent = parseJson<string[]>(user.recentlyViewed, []);
  const alerts = parseJson<unknown[]>(user.priceAlerts, []);

  const stats = [
    ["Wishlist", wishlist.length],
    ["Saved searches", searches.length],
    ["Recently viewed", recent.length],
    ["Price alerts", alerts.length],
  ] as const;

  return (
    <div className="dn-container py-10 sm:py-12 lg:py-14">
      <section className="dn-card overflow-hidden">
        <div className="grid gap-7 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--card)_98%,transparent),color-mix(in_srgb,var(--forest-primary)_6%,var(--card)))] p-5 sm:p-7 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-forest">Your DealForge</p>
            <h1 className="mt-2 font-display text-4xl font-semibold tracking-[-0.035em] text-forest-ink sm:text-5xl">
              Hello, {user.name.split(" ")[0] || "there"}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-forest-muted">
              Your saved products, searches, recent views, alerts, and account controls in one place.
            </p>
            <p className="mt-3 text-xs font-medium text-forest-muted">Signed in as {user.email}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/search" className="dn-button-primary">
              Find products <Search className="h-4 w-4" />
            </Link>
            <LogoutButton />
          </div>
        </div>

        <div className="grid grid-cols-2 border-t border-card-border md:grid-cols-4">
          {stats.map(([label, value], index) => (
            <div key={label} className={`p-4 sm:p-5 ${index % 2 ? "border-l border-card-border" : ""} ${index >= 2 ? "border-t border-card-border md:border-t-0" : ""} ${index === 2 ? "md:border-l" : ""}`}>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-forest-muted">{label}</p>
              <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-forest sm:text-3xl">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-9">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-forest">Account tools</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-forest-ink sm:text-3xl">Pick up where you left off</h2>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LINKS.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className="dn-card dn-card-interactive group flex min-h-36 items-start gap-4 p-5 sm:p-6">
                <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-forest/9 text-forest">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold text-forest-ink group-hover:text-forest">{item.label}</p>
                  <p className="mt-1.5 text-sm leading-6 text-forest-muted">{item.desc}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-forest">
                    Open <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
