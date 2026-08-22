import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Flame,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  Zap,
} from "lucide-react";
import { CategoryGrid } from "@/components/category-grid";
import { InfiniteProductFeed } from "@/components/infinite-feed";
import { ProductCard } from "@/components/product-card";
import { SectionHeader } from "@/components/section-header";
import { AdSlot } from "@/components/ad-slot";
import { AffiliateSpotlight } from "@/components/affiliate-spotlight";
import { getCategories, queryProducts, type ProductDTO } from "@/lib/products";
import { isDatabaseConfigured } from "@/lib/db";
import { getAdsenseConfig } from "@/lib/ads";
import { retailerLabel } from "@/lib/commerce-display";

export const dynamic = "force-dynamic";

function SetupBanner({ message }: { message: string }) {
  return (
    <div className="dn-container py-16">
      <div className="dn-card mx-auto max-w-2xl p-7 text-center sm:p-9">
        <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-forest">DealForge setup</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-forest-ink">Database not connected</h1>
        <p className="mt-3 leading-7 text-forest-muted">{message}</p>
      </div>
    </div>
  );
}

function takeUnique(items: ProductDTO[], seen: Set<string>, limit = 8) {
  const unique: ProductDTO[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
    if (unique.length >= limit) break;
  }
  return unique;
}

export default async function HomePage() {
  if (!isDatabaseConfigured()) {
    return <SetupBanner message="Connect the existing Neon PostgreSQL database to the Cloudflare Worker and deploy a new version." />;
  }

  let categories;
  let featuredResult;
  let trendingResult;
  let newestResult;
  let flashResult;
  let feed;
  try {
    [categories, featuredResult, trendingResult, newestResult, flashResult, feed] = await Promise.all([
      getCategories(),
      queryProducts({ featured: true, limit: 24, sort: "popularity" }),
      queryProducts({ trending: true, limit: 24 }),
      queryProducts({ newest: true, limit: 24, sort: "newest" }),
      queryProducts({ flash: true, limit: 24, sort: "popularity" }),
      queryProducts({ page: 1, limit: 24 }),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown database error";
    return <SetupBanner message={`Could not load products (${msg}). Verify the database connection and deploy again.`} />;
  }

  const seen = new Set<string>();
  const featured = takeUnique(featuredResult.items, seen);
  const trending = takeUnique(trendingResult.items, seen);
  const flash = takeUnique(flashResult.items, seen);
  const newest = takeUnique(newestResult.items, seen);
  const promotedProductIds = Array.from(seen);
  const ads = getAdsenseConfig();
  const spotlight = [...featured, ...trending].slice(0, 3);
  const affiliateSpotlight = newest[0] ?? featured[0] ?? trending[0] ?? null;

  return (
    <div>
      <section className="dn-hero relative overflow-hidden border-b border-white/10">
        <div className="dn-container relative grid items-center gap-9 py-11 md:grid-cols-[1.08fr_.92fr] md:py-18 lg:gap-14 lg:py-22">
          <div className="animate-fade-up">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#F97316]/30 bg-[#F97316]/10 px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#FB923C] shadow-sm backdrop-blur sm:text-xs">
              <Sparkles className="h-3.5 w-3.5" /> Smarter product discovery
            </div>

            <h1 className="mt-5 max-w-3xl font-display text-[2.6rem] font-semibold leading-[1.01] tracking-[-0.045em] text-white sm:text-5xl md:text-6xl lg:text-7xl">
              Forge better deals. <span className="text-[#F97316]">Shop with more clarity.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-white/63 md:text-lg md:leading-8">
              Find useful products from Amazon and other trusted retailers. DealForge clearly separates verified and recorded pricing, then sends you to the retailer for the final offer and checkout.
            </p>

            <form action="/search" method="get" className="mt-7 max-w-2xl" role="search">
              <div className="flex items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.075] p-2 shadow-2xl shadow-black/30 backdrop-blur">
                <Search className="ml-2 h-5 w-5 shrink-0 text-white/45" aria-hidden="true" />
                <input
                  name="q"
                  type="search"
                  autoComplete="off"
                  aria-label="Search DealForge products"
                  placeholder="Search headphones, tools, home, books…"
                  className="min-h-11 min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-white outline-none placeholder:text-white/35"
                />
                <button type="submit" className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-xl bg-[#F97316] px-4 text-sm font-extrabold text-white shadow-[0_8px_24px_rgba(249,115,22,.24)] transition hover:-translate-y-0.5 hover:bg-[#EA580C] sm:px-6">
                  Find products <ArrowRight className="hidden h-4 w-4 sm:block" aria-hidden="true" />
                </button>
              </div>
            </form>

            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-white/45">
              <span>Popular:</span>
              <Link href="/search?q=headphones" className="rounded-full border border-white/10 px-2.5 py-1.5 font-semibold text-white/66 hover:border-[#F97316]/35 hover:text-[#FB923C]">Headphones</Link>
              <Link href="/search?q=tools" className="rounded-full border border-white/10 px-2.5 py-1.5 font-semibold text-white/66 hover:border-[#F97316]/35 hover:text-[#FB923C]">Tools</Link>
              <Link href="/search?q=home" className="rounded-full border border-white/10 px-2.5 py-1.5 font-semibold text-white/66 hover:border-[#F97316]/35 hover:text-[#FB923C]">Home</Link>
            </div>

            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2.5 text-xs font-semibold text-white/54">
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-[#FB923C]" /> Price-state transparency</span>
              <span className="inline-flex items-center gap-1.5"><BadgeCheck className="h-4 w-4 text-[#FB923C]" /> Clear affiliate disclosure</span>
              <span className="inline-flex items-center gap-1.5"><Zap className="h-4 w-4 text-[#FB923C]" /> Direct retailer handoff</span>
            </div>

            <div className="mt-8 grid max-w-2xl grid-cols-3 divide-x divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.055] shadow-sm backdrop-blur">
              <div className="p-3.5 sm:p-5">
                <p className="text-xl font-extrabold text-white sm:text-2xl">{feed.total.toLocaleString()}</p>
                <p className="mt-0.5 text-[9px] font-extrabold uppercase tracking-[0.12em] text-white/40 sm:text-[10px]">products</p>
              </div>
              <div className="p-3.5 sm:p-5">
                <p className="text-xl font-extrabold text-white sm:text-2xl">{categories.length}</p>
                <p className="mt-0.5 text-[9px] font-extrabold uppercase tracking-[0.12em] text-white/40 sm:text-[10px]">categories</p>
              </div>
              <div className="p-3.5 sm:p-5">
                <p className="text-xl font-extrabold text-white sm:text-2xl">24h</p>
                <p className="mt-0.5 text-[9px] font-extrabold uppercase tracking-[0.12em] text-white/40 sm:text-[10px]">freshness target</p>
              </div>
            </div>
          </div>

          <div className="relative hidden animate-fade-up md:block" style={{ animationDelay: "100ms" }}>
            <div className="absolute -inset-8 rounded-full bg-[#F97316]/15 blur-3xl" />
            <div className="dn-forge-glow relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#151515]/90 p-4 lg:p-5">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#FB923C]">DealForge radar</p>
                  <p className="mt-1 font-display text-xl font-semibold text-white">Popular right now</p>
                </div>
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#F97316]/10">
                  <Flame className="h-5 w-5 text-[#F97316]" />
                </span>
              </div>

              <div className="mt-2 divide-y divide-white/10">
                {spotlight.map((product, index) => (
                  <Link key={product.id} href={`/product/${product.slug}`} className="group flex min-h-18 items-center gap-4 rounded-lg py-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F97316]/12 text-xs font-extrabold text-[#FB923C]">{String(index + 1).padStart(2, "0")}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-white group-hover:text-[#FB923C]">{product.title}</p>
                      <p className="mt-0.5 text-xs text-white/40">{retailerLabel(product.retailer)} · {product.brand}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-white/35 transition group-hover:translate-x-1 group-hover:text-[#FB923C]" />
                  </Link>
                ))}
              </div>

              <Link href="/search?sort=popularity" className="mt-2 inline-flex min-h-12 items-center gap-2 rounded-xl bg-[#F97316] px-4 text-sm font-extrabold text-white shadow-[0_8px_24px_rgba(249,115,22,.18)] transition hover:-translate-y-0.5 hover:bg-[#EA580C]">
                Explore popular products <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-card-border bg-card/55">
        <div className="dn-container grid gap-0 sm:grid-cols-3">
          {[
            [Search, "Discover", "Search by product, brand, category, or what you need it to do."],
            [ShieldCheck, "Compare clearly", "See whether pricing is current, recorded, or needs retailer verification."],
            [Store, "Finish with retailer", "Open the retailer listing yourself to confirm final price and checkout."],
          ].map(([Icon, title, copy], index) => {
            const ItemIcon = Icon as typeof Search;
            return (
              <div key={title as string} className={`flex gap-3 py-5 sm:px-5 ${index > 0 ? "border-t border-card-border sm:border-l sm:border-t-0" : ""}`}>
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-forest/9 text-forest">
                  <ItemIcon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-extrabold text-forest-ink">{title as string}</p>
                  <p className="mt-1 text-xs leading-5 text-forest-muted">{copy as string}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <AdSlot client={ads.client} slot={ads.homeTop} className="dn-container mt-8" />

      {affiliateSpotlight ? <AffiliateSpotlight product={affiliateSpotlight} /> : null}

      {featured.length ? (
        <section className="dn-container dn-section">
          <SectionHeader title="Featured Finds" subtitle="Strong products worth a closer look" href="/search?featured=1" />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {featured.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      ) : null}

      <section className="dn-section dn-section-muted">
        <div className="dn-container">
          <SectionHeader title="Shop by Category" subtitle="Jump directly to what you need" href="/categories" />
          <CategoryGrid categories={categories} />
        </div>
      </section>

      {trending.length ? (
        <section className="dn-container dn-section">
          <SectionHeader title="Trending Now" subtitle="Products shoppers are exploring" href="/search?sort=popularity" />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {trending.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      ) : null}

      <AdSlot client={ads.client} slot={ads.homeFeed} className="dn-container" />

      {flash.length ? (
        <section className="dn-container dn-section">
          <SectionHeader title="Deal Watch" subtitle="Products flagged for savings — confirm the final price with the retailer" href="/deals" />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {flash.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      ) : null}

      {newest.length ? (
        <section className="dn-section dn-section-muted">
          <div className="dn-container">
            <SectionHeader title="Recently Added" subtitle="Fresh additions to the DealForge catalog" href="/search?sort=newest" />
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
              {newest.map((p) => <ProductCard key={p.id} product={p} />)}
            </div>
          </div>
        </section>
      ) : null}

      <section className="dn-container pb-16 pt-12 md:pt-16">
        <SectionHeader title="Browse Everything" subtitle="Keep scrolling through the catalog" />
        <InfiniteProductFeed initial={feed} excludeIds={promotedProductIds} />
      </section>
    </div>
  );
}
