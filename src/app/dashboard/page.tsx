import Link from "next/link";
import { redirect } from "next/navigation";
import {
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
  { href: "/dashboard/wishlist", label: "Wishlist", icon: Heart, desc: "Products you saved" },
  { href: "/dashboard/searches", label: "Saved searches", icon: Search, desc: "Jump back into filters" },
  { href: "/dashboard/recent", label: "Recently viewed", icon: Clock, desc: "Pick up where you left off" },
  { href: "/dashboard/alerts", label: "Price alerts", icon: Bell, desc: "Get notified on drops" },
  { href: "/dashboard/settings", label: "Account settings", icon: Settings, desc: "Profile & preferences" },
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

  return (
    <div className="dn-container py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-forest">Dashboard</p>
          <h1 className="mt-1 font-display text-4xl font-semibold text-forest-ink">
            Hello, {user.name.split(" ")[0]}
          </h1>
          <p className="mt-2 text-forest-muted">{user.email}</p>
        </div>
        <LogoutButton />
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Wishlist", wishlist.length],
          ["Saved searches", searches.length],
          ["Recently viewed", recent.length],
          ["Price alerts", alerts.length],
        ].map(([label, value]) => (
          <div key={label as string} className="dn-card p-4">
            <p className="text-xs uppercase tracking-wide text-forest-muted">{label}</p>
            <p className="mt-1 text-2xl font-bold text-forest">{value as number}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {LINKS.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="dn-card flex items-start gap-4 p-5 transition hover:-translate-y-0.5 hover:border-forest/40"
            >
              <span className="rounded-2xl bg-forest/10 p-3 text-forest">
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <p className="font-semibold text-forest-ink">{item.label}</p>
                <p className="mt-1 text-sm text-forest-muted">{item.desc}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
