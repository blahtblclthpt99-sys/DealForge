import Link from "next/link";
import { ArrowRight, RefreshCw, Search, ShieldCheck, Sparkles } from "lucide-react";
import { CategoryGrid } from "@/components/category-grid";
import { InfiniteProductFeed } from "@/components/infinite-feed";
import { ProductCard } from "@/components/product-card";
import { SectionHeader } from "@/components/section-header";
import { getCategories, queryProducts } from "@/lib/products";
import { isDatabaseConfigured } from "@/lib/db";
import { publicCatalogItems } from "@/lib/public-catalog";

export const dynamic = "force-dynamic";

function SetupBanner({ message }: { message: string }) {
  return <div className="dn-container py-16"><div className="mx-auto max-w-2xl rounded-2xl border border-card-border bg-card p-8 text-center"><p className="text-sm font-semibold uppercase tracking-wide text-forest">DealForge setup</p><h1 className="mt-2 font-display text-3xl font-semibold text-forest-ink">Catalog unavailable</h1><p className="mt-3 text-forest-muted">{message}</p></div></div>;
}

export default async function HomePage() {
  if (!isDatabaseConfigured()) return <SetupBanner message="DealForge requires its production database connection before the live catalog can load." />;

  let categories;
  let trending;
  let newest;
  let flash;
  let feed;
  try {
    [categories, trending, newest, flash, feed] = await Promise.all([
      getCategories(),
      queryProducts({ trending: true, limit: 8 }),
      queryProducts({ newest: true, limit: 8, sort: "newest" }),
      queryProducts({ flash: true, limit: 8 }),
      queryProducts({ page: 1, limit: 24 }),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error";
    return <SetupBanner message={`Could not load the live catalog (${message}).`} />;
  }

  const popularItems = publicCatalogItems(trending.items);
  const newestItems = publicCatalogItems(newest.items);
  const verifiedOffers = publicCatalogItems(flash.items).filter((product) => product.priceVerified && product.availabilityVerified && product.availability === "in_stock");

  return (
    <div>
      <section className="relative overflow-hidden border-b border-card-border">
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 60% at 20% 20%, color-mix(in srgb, #6FBF73 32%, transparent), transparent), radial-gradient(ellipse 65% 45% at 90% 0%, color-mix(in srgb, #F97316 12%, transparent), transparent), linear-gradient(180deg, #F5F8F5 0%, color-mix(in srgb, #328246 7%, #F5F8F5) 100%)" }} />
        <div className="dn-container relative py-12 md:py-18">
          <div className="max-w-3xl animate-fade-up">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-forest">Smarter product discovery</p>
            <h1 className="mt-3 font-display text-4xl font-semibold leading-[1.08] tracking-tight text-forest-ink md:text-6xl">Find what you want without guessing what&apos;s current.</h1>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-forest-muted md:text-lg">DealForge separates direct DealForge offers from retailer-check listings and makes price and stock confidence clear before you act.</p>

            <form action="/search" method="get" className="mt-7 flex max-w-2xl gap-2 rounded-2xl border border-card-border bg-card p-2 shadow-sm">
              <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-forest-muted" /><input name="q" type="search" placeholder="Search products, brands, categories…" className="w-full rounded-xl bg-transparent py-3 pl-10 pr-3 text-sm text-forest-ink outline-none placeholder:text-forest-muted" aria-label="Search DealForge" /></div>
              <button type="submit" className="rounded-xl bg-forest px-5 py-3 text-sm font-semibold text-white transition hover:bg-forest-dark">Search</button>
            </form>

            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/categories" className="inline-flex items-center gap-2 rounded-full border border-card-border bg-card/80 px-4 py-2 text-sm font-semibold text-forest-ink hover:border-forest/40">Browse categories <ArrowRight className="h-3.5 w-3.5" /></Link>
              <Link href="/search" className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-forest hover:bg-forest/10">Shop all products</Link>
            </div>
          </div>

          <div className="mt-8 grid gap-2 sm:grid-cols-3">
            <div className="flex items-center gap-2 rounded-xl border border-card-border bg-card/70 px-3 py-2.5 text-xs text-forest-muted backdrop-blur"><ShieldCheck className="h-4 w-4 shrink-0 text-forest" /> Direct DealForge offers are clearly labeled</div>
            <div className="flex items-center gap-2 rounded-xl border border-card-border bg-card/70 px-3 py-2.5 text-xs text-forest-muted backdrop-blur"><RefreshCw className="h-4 w-4 shrink-0 text-forest" /> Stale stock is not presented as current</div>
            <div className="flex items-center gap-2 rounded-xl border border-card-border bg-card/70 px-3 py-2.5 text-xs text-forest-muted backdrop-blur"><Sparkles className="h-4 w-4 shrink-0 text-forest" /> Retailer checks stay one tap away</div>
          </div>
        </div>
      </section>

      <section className="border-b border-card-border bg-card/40 py-10 md:py-12"><div className="dn-container"><SectionHeader title="Shop by category" subtitle="Jump straight to the aisle you need" href="/categories" /><CategoryGrid categories={categories} /></div></section>

      {popularItems.length > 0 && <section className="dn-container py-10 md:py-12"><SectionHeader title="Popular now" subtitle="Products shoppers are exploring" href="/search?sort=popularity" /><div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">{popularItems.map((product) => <ProductCard key={product.id} product={product} />)}</div></section>}

      {newestItems.length > 0 && <section className="dn-container py-10 md:py-12"><SectionHeader title="Newly added" subtitle="Recent additions to the DealForge catalog" href="/search?sort=newest" /><div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">{newestItems.map((product) => <ProductCard key={product.id} product={product} />)}</div></section>}

      {verifiedOffers.length > 0 && <section className="border-y border-card-border bg-card/40 py-10 md:py-12"><div className="dn-container"><SectionHeader title="Verified offers" subtitle="Current price and availability signals passed DealForge checks" href="/deals" /><div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">{verifiedOffers.map((product) => <ProductCard key={product.id} product={product} />)}</div></div></section>}

      <section className="dn-container pb-14 pt-10 md:pb-16 md:pt-12"><SectionHeader title="Browse all products" subtitle="Keep scrolling to discover more" /><InfiniteProductFeed initial={feed} /></section>
    </div>
  );
}
