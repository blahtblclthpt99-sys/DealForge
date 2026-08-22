import Image from "next/image";
import Link from "next/link";
import { BadgeCheck, ExternalLink, ShieldCheck } from "lucide-react";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-white/10 bg-[#09090a] text-white">
      <div className="dn-container py-12 md:py-14">
        <div className="grid gap-10 lg:grid-cols-[1.35fr_.65fr_.65fr]">
          <div>
            <Link href="/" className="inline-flex min-h-12 items-center gap-3 rounded-xl pr-2" aria-label="DealForge home">
              <Image
                src="/dealforge-logo.png"
                alt=""
                width={56}
                height={56}
                className="h-14 w-14 rounded-2xl object-cover ring-1 ring-white/10 shadow-[0_0_30px_rgba(249,115,22,.14)]"
              />
              <span className="font-display text-2xl font-semibold tracking-tight text-white">
                Deal<span className="text-[#F97316]">Forge</span>
              </span>
            </Link>

            <p className="mt-4 max-w-xl text-sm leading-7 text-white/56">
              Discover products and deal opportunities from trusted retailers. DealForge helps you compare what we know, clearly marks price freshness, and sends you to the retailer for the final offer and checkout.
            </p>

            <div className="mt-5 grid max-w-2xl gap-2.5 sm:grid-cols-2">
              <div className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.045] p-3.5">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#FB923C]" />
                <div>
                  <p className="text-xs font-bold text-white">Price clarity</p>
                  <p className="mt-1 text-[11px] leading-5 text-white/45">Recorded prices are labeled; final terms come from the retailer.</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.045] p-3.5">
                <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#FB923C]" />
                <div>
                  <p className="text-xs font-bold text-white">Transparent affiliate model</p>
                  <p className="mt-1 text-[11px] leading-5 text-white/45">Some outbound retailer links may earn DealForge a commission.</p>
                </div>
              </div>
            </div>

            <div className="mt-5 inline-flex rounded-xl border border-[#F97316]/22 bg-[#F97316]/9 px-4 py-3 text-xs font-semibold leading-relaxed text-white/82">
              As an Amazon Associate I earn from qualifying purchases.
            </div>
          </div>

          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-white/72">Explore</p>
            <ul className="mt-4 space-y-1 text-sm text-white/52">
              <li><Link href="/categories" className="inline-flex min-h-10 items-center hover:text-[#FB923C]">Categories</Link></li>
              <li><Link href="/deals" className="inline-flex min-h-10 items-center hover:text-[#FB923C]">Deal Watch</Link></li>
              <li><Link href="/search" className="inline-flex min-h-10 items-center hover:text-[#FB923C]">Product Finder</Link></li>
              <li><Link href="/dashboard" className="inline-flex min-h-10 items-center hover:text-[#FB923C]">Dashboard</Link></li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-white/72">Account</p>
            <ul className="mt-4 space-y-1 text-sm text-white/52">
              <li><Link href="/login" className="inline-flex min-h-10 items-center hover:text-[#FB923C]">Sign in</Link></li>
              <li><Link href="/register" className="inline-flex min-h-10 items-center hover:text-[#FB923C]">Create account</Link></li>
              <li><Link href="/dashboard/wishlist" className="inline-flex min-h-10 items-center hover:text-[#FB923C]">Wishlist</Link></li>
              <li>
                <Link href="/search" className="inline-flex min-h-10 items-center gap-1.5 hover:text-[#FB923C]">
                  Find a product <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="dn-container flex flex-col gap-3 py-5 sm:flex-row sm:items-baseline sm:justify-between">
          <p className="max-w-4xl text-[11px] leading-relaxed text-white/38">
            © {new Date().getFullYear()} DealForge. Product links may be affiliate links. Prices, availability, seller, shipping, promotions, and eligibility can change; verify final terms with the retailer before purchase.
          </p>
          <Link href="/ads.txt" className="inline-flex min-h-8 shrink-0 items-center text-[11px] text-white/34 hover:text-[#FB923C]">
            ads.txt
          </Link>
        </div>
      </div>
    </footer>
  );
}
