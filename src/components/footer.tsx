import Image from "next/image";
import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-white/10 bg-[#0b0b0c] text-white">
      <div className="dn-container grid gap-10 py-12 md:grid-cols-4">
        <div className="md:col-span-2">
          <Link href="/" className="inline-flex items-center gap-3">
            <Image
              src="/dealforge-logo.png"
              alt="DealForge"
              width={56}
              height={56}
              className="h-14 w-14 rounded-2xl object-cover ring-1 ring-white/10 shadow-[0_0_30px_rgba(249,115,22,.14)]"
            />
            <span className="font-display text-2xl font-semibold tracking-tight text-white">
              Deal<span className="text-[#F97316]">Forge</span>
            </span>
          </Link>
          <p className="mt-4 max-w-lg text-sm leading-7 text-white/55">
            Forge better deals from trusted retailers. DealForge helps shoppers discover products,
            compare offers, and verify the final price directly with the retailer before checkout.
          </p>
          <div className="mt-5 inline-flex rounded-xl border border-[#F97316]/25 bg-[#F97316]/10 px-4 py-3 text-xs font-semibold leading-relaxed text-white/85">
            As an Amazon Associate I earn from qualifying purchases.
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Explore</p>
          <ul className="mt-3 space-y-2.5 text-sm text-white/50">
            <li><Link href="/categories" className="hover:text-[#FB923C]">Categories</Link></li>
            <li><Link href="/deals" className="hover:text-[#FB923C]">Deal Watch</Link></li>
            <li><Link href="/search" className="hover:text-[#FB923C]">Search</Link></li>
            <li><Link href="/dashboard" className="hover:text-[#FB923C]">Dashboard</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Account</p>
          <ul className="mt-3 space-y-2.5 text-sm text-white/50">
            <li><Link href="/login" className="hover:text-[#FB923C]">Sign in</Link></li>
            <li><Link href="/register" className="hover:text-[#FB923C]">Create account</Link></li>
            <li><Link href="/dashboard/wishlist" className="hover:text-[#FB923C]">Wishlist</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="dn-container flex flex-col gap-2 py-5 sm:flex-row sm:items-baseline sm:justify-between">
          <p className="text-[11px] leading-relaxed text-white/40">
            © {new Date().getFullYear()} DealForge. Product links may be affiliate links. Prices,
            availability, seller, shipping, and promotions can change; verify final terms with the retailer.
          </p>
          <Link href="/ads.txt" className="text-[11px] text-white/35 hover:text-[#FB923C]">
            ads.txt
          </Link>
        </div>
      </div>
    </footer>
  );
}
