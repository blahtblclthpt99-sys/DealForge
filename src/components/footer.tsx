import Image from "next/image";
import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-card-border bg-card/80 backdrop-blur">
      <div className="dn-container grid gap-10 py-12 md:grid-cols-4">
        <div className="md:col-span-2">
          <Link href="/" className="inline-flex items-center gap-3">
            <Image
              src="/dealforge-logo.png"
              alt="DealForge"
              width={56}
              height={56}
              className="h-14 w-14 rounded-2xl object-cover shadow-sm"
            />
            <span className="font-display text-2xl font-semibold tracking-tight text-forest-ink">
              Deal<span className="text-[#F97316]">Forge</span>
            </span>
          </Link>
          <p className="mt-4 max-w-lg text-sm leading-7 text-forest-muted">
            Discover useful products and retailer offers without pretending an old price is current.
            DealForge is a discovery and affiliate platform; purchases happen on the retailer site.
          </p>
          <div className="mt-5 inline-flex rounded-xl border border-card-border bg-background/70 px-4 py-3 text-xs font-semibold leading-relaxed text-forest-ink">
            As an Amazon Associate I earn from qualifying purchases.
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-forest-ink">Explore</p>
          <ul className="mt-3 space-y-2.5 text-sm text-forest-muted">
            <li><Link href="/categories" className="hover:text-forest">Categories</Link></li>
            <li><Link href="/deals" className="hover:text-forest">Deals</Link></li>
            <li><Link href="/search" className="hover:text-forest">Search</Link></li>
            <li><Link href="/dashboard" className="hover:text-forest">Dashboard</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-forest-ink">Account</p>
          <ul className="mt-3 space-y-2.5 text-sm text-forest-muted">
            <li><Link href="/login" className="hover:text-forest">Sign in</Link></li>
            <li><Link href="/register" className="hover:text-forest">Create account</Link></li>
            <li><Link href="/dashboard/wishlist" className="hover:text-forest">Wishlist</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-card-border">
        <div className="dn-container flex flex-col gap-2 py-5 sm:flex-row sm:items-baseline sm:justify-between">
          <p className="text-[11px] leading-relaxed text-forest-muted/75">
            © {new Date().getFullYear()} DealForge. Product links may be affiliate links. Prices,
            availability, seller, shipping, and promotions can change; verify final terms with the retailer.
          </p>
          <Link href="/ads.txt" className="text-[11px] text-forest-muted/60 hover:text-forest">
            ads.txt
          </Link>
        </div>
      </div>
    </footer>
  );
}
