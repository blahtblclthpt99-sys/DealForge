import Link from "next/link";
import { ArrowRight, BadgeCheck, Flame, Search, ShieldCheck, Sparkles, Zap } from "lucide-react";
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
      <div className="mx-auto max-w-2xl rounded-2xl border border-card-border bg-card p-8 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-forest">DealForge setup</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-forest-ink">Database not connected</h1>
        <p className="mt-3 text-forest-muted">{message}</p>
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
        <div className="dn-container relative grid items-center gap-10 py-12 md:grid-cols-[1.08fr_.92fr] md:py-20 lg:py-24">
          <div className="animate-fade-up">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#F97316]/30 bg-[#F97316]/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-[#FB923C] shadow-sm backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" /> Forge better deals
            </div>
            <h1 className="mt-5 max-w-3xl font-display text-4xl font-semibold leading-[1.01] tracking-[-0.04em] text-white sm:text-5xl md:text-6xl lg:text-7xl">
              Forge better deals. <span className="text-[#F97316]">Save more every day.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-white/60 md:text-lg">
              Discover products from Amazon and other trusted retailers without stale-price guesswork. DealForge helps you find the item, then sends you to the retailer for the current offer and checkout.
            </p>

            <form action="/search" method="get" className="mt-7 max-w-2xl">
              <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.07] p-2 shadow-xl shadow-black/30 backdrop-blur">
                <Search className="ml-2 h-5 w-5 shrink-0 text-white/45" />
                <input
                  name="q"
                  type="search"
                  placeholder="Search headphones, tools, home, books…"
                  className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-white outline-none placeholder:text-white/35"
                />
                <button type="submit" className="min-h-11 shrink-0 rounded-xl bg-[#F97316] px-4 text-sm font-bold text-white shadow-[0_8px_24px_rgba(249,115,22,.22)] transition hover:bg-[#EA580C] sm:px-6">
                  Search
                </button>
              </div>
            </form>

            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-white/50">
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-[#FB923C]" /> Price freshness guard</span>
              <span className="inline-flex items-center gap-1.5"><BadgeCheck className="h-4 w-4 text-[#FB923C]" /> Tagged affiliate links</span>
              <span className="inline-flex items-center gap-1.5"><Zap className="h-4 w-4 text-[#FB923C]" /> Fast retailer handoff</span>
            </div>

            <div className="mt-8 grid max-w-2xl grid-cols-3 divide-x divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] shadow-sm backdrop-blur">
              <div className="p-4 sm:p-5">
                <p className="text-xl font-extrabold text-white sm:text-2xl">{feed.total.toLocaleString()}</p>
                <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">products</p>
              </div>
              <div className="p-4 sm:p-5">
                <p className="text-xl font-extrabold text-white sm:text-2xl">{categories.length}</p>
                <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">categories</p>
              </div>
              <div className="p-4 sm:p-5">
                <p className="text-xl font-extrabold text-white sm:text-2xl">24h</p>
                <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">price freshness target</p>
              </div>
            </div>
          </div>

          <div className="relative hidden animate-fade-up md:block" style={{ animationDelay: "100ms" }}>
            <div className="absolute -inset-8 rounded-full bg-[#F97316]/15 blur-3xl" />
            <div className="dn-forge-glow relative overflow-hidden rounded-[1.4rem] border border-white/10 bg-[#151515]/90 p-4 lg:p-5">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#FB923C]">DealForge radar</p>
                  <p className="mt-1 font-display text-xl font-semibold text-white">Popular right now</p>
                </div>
                <Flame className="h-5 w-5 text-[#F97316]" />
              </div>
              <div className="mt-2 divide-y divide-white/10">
                {spotlight.map((product, index) => (
                  <Link key={product.id} href={`/product/${product.slug}`} className="group flex items-center gap-4 py-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#F97316]/12 text-xs font-extrabold text-[#FB923C]">{String(index + 1).padStart(2, "0")}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-white group-hover:text-[#FB923C]">{product.title}</p>
                      <p className="mt-0.5 text-xs text-white/40">{retailerLabel(product.retailer)} · {product.brand}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-white/35 transition group-hover:translate-x-1 group-hover:text-[#FB923C]" />
                  </Link>
                ))}
              </div>
              <Link href="/search?sort=popularity" className="mt-2 inline-flex items-center gap-2 rounded-xl bg-[#F97316] px-4 py-3 text-sm font-bold text-white shadow-[0_8px_24px_rgba(249,115,22,.18)] transition hover:bg-[#EA580C]">
                Explore popular products <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <AdSlot client={ads.client} slot={ads.homeTop} className="dn-container mt-8" />

      {affiliateSpotlight ? <AffiliateSpotlight product={affiliateSpotlight} /> : null}

      {featured.length ? (
        <section className="dn-container py-12 md:py-16">
          <SectionHeader title="Featured Finds" subtitle="Strong products worth a closer look" href="/search?featured=1" />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {featured.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      ) : null}

      <section className="border-y border-card-border bg-card/45 py-12 md:py-16">
        <div className="dn-container">
          <SectionHeader title="Shop by Category" subtitle="Jump directly to what you need" href="/categories" />
          <CategoryGrid categories={categories} />
        </div>
      </section>

      {trending.length ? (
        <section className="dn-container py-12 md:py-16">
          <SectionHeader title="Trending Now" subtitle="Products shoppers are exploring" href="/search?sort=popularity" />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {trending.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      ) : null}

      <AdSlot client={ads.client} slot={ads.homeFeed} className="dn-container" />

      {flash.length ? (
        <section className="dn-container py-12 md:py-16">
          <SectionHeader title="Deal Watch" subtitle="Products flagged for savings — confirm the final price with the retailer" href="/deals" />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {flash.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      ) : null}

      {newest.length ? (
        <section className="border-y border-card-border bg-card/35 py-12 md:py-16">
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
