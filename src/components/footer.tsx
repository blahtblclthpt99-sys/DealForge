import Image from "next/image";
import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-card-border bg-card">
      <div className="dn-container grid gap-8 py-12 md:grid-cols-4">
        <div className="md:col-span-2">
          <Link href="/" className="inline-flex items-center gap-3">
            <Image
              src="/dealforge-logo.png"
              alt="DealForge"
              width={56}
              height={56}
              className="h-14 w-14 rounded-xl object-cover shadow-sm"
            />
            <span className="font-display text-2xl font-semibold tracking-tight text-forest-ink">
              Deal<span className="text-[#F97316]">Forge</span>
            </span>
          </Link>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-forest-muted">
            Discover products with verified supplier and pricing context. DealForge supports
            direct checkout when sourcing, inventory, and payment checks are satisfied.
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-forest-ink">Explore</p>
          <ul className="mt-3 space-y-2 text-sm text-forest-muted">
            <li>
              <Link href="/categories" className="hover:text-forest">
                Categories
              </Link>
            </li>
            <li>
              <Link href="/deals" className="hover:text-forest">
                Flash Deals
              </Link>
            </li>
            <li>
              <Link href="/search" className="hover:text-forest">
                Search
              </Link>
            </li>
            <li>
              <Link href="/dashboard" className="hover:text-forest">
                Dashboard
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-forest-ink">Account</p>
          <ul className="mt-3 space-y-2 text-sm text-forest-muted">
            <li>
              <Link href="/login" className="hover:text-forest">
                Sign in
              </Link>
            </li>
            <li>
              <Link href="/register" className="hover:text-forest">
                Create account
              </Link>
            </li>
            <li>
              <Link href="/dashboard/wishlist" className="hover:text-forest">
                Wishlist
              </Link>
            </li>
            <li>
              <Link href="/admin" className="hover:text-forest">
                Admin
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-card-border">
        <div className="dn-container flex flex-col gap-2 py-5 sm:flex-row sm:items-baseline sm:justify-between">
          <p className="text-[11px] leading-relaxed text-forest-muted/70">
            © {new Date().getFullYear()} DealForge. Some product links may be affiliate links.
            Direct purchases are handled by DealForge when available. Prices and availability can change.
          </p>
        </div>
      </div>
    </footer>
  );
}
