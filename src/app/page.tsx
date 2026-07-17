import Link from "next/link";
import { ArrowRight, Flame, Sparkles, Zap } from "lucide-react";
import { CategoryGrid } from "@/components/category-grid";
import { InfiniteProductFeed } from "@/components/infinite-feed";
import { ProductCard } from "@/components/product-card";
import { SectionHeader } from "@/components/section-header";
import { getCategories, queryProducts } from "@/lib/products";
import { isDatabaseConfigured } from "@/lib/db";

function SetupBanner({ message }: { message: string }) {
  return (
    <div className="dn-container py-16">
      <div className="mx-auto max-w-2xl rounded-2xl border border-card-border bg-card p-8 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-forest">DealForge setup</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-forest-ink">
          Database not connected
        </h1>
        <p className="mt-3 text-forest-muted">{message}</p>
        <ol className="mt-6 list-decimal space-y-2 pl-5 text-left text-sm text-forest-ink">
          <li>
            Create a free Postgres database at{" "}
            <a className="text-forest underline" href="https://neon.tech" target="_blank" rel="noreferrer">
              neon.tech
            </a>
          </li>
          <li>
            In Vercel → Project → Settings → Environment Variables, set{" "}
            <code className="rounded bg-forest/10 px-1">DATABASE_URL</code> to the Neon connection
            string
          </li>
          <li>
            Also set <code className="rounded bg-forest/10 px-1">AUTH_SECRET</code> and{" "}
            <code className="rounded bg-forest/10 px-1">NEXT_PUBLIC_APP_URL</code>=
            <code className="rounded bg-forest/10 px-1">https://deal-forge.sale</code>
          </li>
          <li>
            From your PC, seed the database:
            <pre className="mt-2 overflow-x-auto rounded-lg bg-forest/5 p-3 text-xs">
              {`$env:DATABASE_URL="postgresql://..."
npx prisma db push --schema=prisma/schema.postgres.prisma
npm run db:seed`}
            </pre>
          </li>
          <li>Redeploy on Vercel</li>
        </ol>
      </div>
    </div>
  );
}

export default async function HomePage() {
  if (!isDatabaseConfigured()) {
    return (
      <SetupBanner message="Vercel cannot use the local SQLite file. Connect a PostgreSQL database (Neon is free) and redeploy." />
    );
  }

  let categories;
  let featured;
  let trending;
  let newest;
  let flash;
  let feed;
  try {
    [categories, featured, trending, newest, flash, feed] = await Promise.all([
      getCategories(),
      queryProducts({ featured: true, limit: 8, sort: "savings" }),
      queryProducts({ trending: true, limit: 8 }),
      queryProducts({ newest: true, limit: 8, sort: "newest" }),
      queryProducts({ flash: true, limit: 8, sort: "savings" }),
      queryProducts({ page: 1, limit: 24 }),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown database error";
    return (
      <SetupBanner
        message={`Could not load products (${msg}). Set a PostgreSQL DATABASE_URL in Vercel and run prisma db push + seed against it.`}
      />
    );
  }

  return (
      <div>
        <section className="relative overflow-hidden border-b border-card-border">
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 80% 60% at 20% 20%, color-mix(in srgb, #6FBF73 35%, transparent), transparent), radial-gradient(ellipse 70% 50% at 85% 10%, color-mix(in srgb, #2E8B4A 28%, transparent), transparent), linear-gradient(180deg, #F5F8F5 0%, color-mix(in srgb, #328246 8%, #F5F8F5) 100%)",
            }}
          />
          <div className="dark:hidden absolute inset-0 opacity-40" />
          <div className="dn-container relative grid items-center gap-10 py-16 md:grid-cols-[1.1fr_0.9fr] md:py-24">
            <div className="animate-fade-up">
              <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-forest">
                Product discovery
              </p>
              <h1 className="font-display text-4xl font-semibold leading-[1.1] tracking-tight text-forest-ink md:text-6xl">
                DealForge
              </h1>
              <p className="mt-4 max-w-xl text-lg text-forest-muted">
                Find trending products, flash savings, and curated deals from trusted retailers —
                then buy where the price is best.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/search"
                  className="inline-flex items-center gap-2 rounded-full bg-forest px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-forest-dark"
                >
                  Explore deals <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/categories"
                  className="inline-flex items-center gap-2 rounded-full border border-card-border bg-card px-5 py-3 text-sm font-semibold text-forest-ink hover:border-forest/40"
                >
                  Browse categories
                </Link>
              </div>
            </div>
            <div className="relative hidden animate-fade-up md:block" style={{ animationDelay: "120ms" }}>
              <div className="dn-card relative overflow-hidden p-6">
                <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-forest-accent/30 blur-2xl" />
                <div className="absolute -bottom-10 -left-6 h-36 w-36 rounded-full bg-forest/25 blur-2xl" />
                <div className="relative space-y-4">
                  <div className="flex items-center gap-3 rounded-2xl bg-forest/10 p-4">
                    <Flame className="h-5 w-5 text-forest" />
                    <div>
                      <p className="text-sm font-semibold text-forest-ink">Trending now</p>
                      <p className="text-xs text-forest-muted">Ranked by savings, ratings & demand</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 rounded-2xl bg-forest/10 p-4">
                    <Zap className="h-5 w-5 text-forest" />
                    <div>
                      <p className="text-sm font-semibold text-forest-ink">Flash deals</p>
                      <p className="text-xs text-forest-muted">Limited-time drops refreshed daily</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 rounded-2xl bg-forest/10 p-4">
                    <Sparkles className="h-5 w-5 text-forest" />
                    <div>
                      <p className="text-sm font-semibold text-forest-ink">Retailer links</p>
                      <p className="text-xs text-forest-muted">
                        We route you to stores — we never sell stock
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="dn-container py-14">
          <SectionHeader
            title="Featured Deals"
            subtitle="Hand-picked savings with strong ratings"
            href="/search?featured=1"
          />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {featured.items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>

        <section className="border-y border-card-border bg-card/50 py-14">
          <div className="dn-container">
            <SectionHeader
              title="Popular Categories"
              subtitle="Browse every aisle"
              href="/categories"
            />
            <CategoryGrid categories={categories} />
          </div>
        </section>

        <section className="dn-container py-14">
          <SectionHeader
            title="Trending Products"
            subtitle="What shoppers are clicking now"
            href="/search?sort=popularity"
          />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {trending.items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>

        <section className="dn-container py-14">
          <SectionHeader title="Flash Deals" subtitle="Limited-time price drops" href="/deals" />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {flash.items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>

        <section className="dn-container py-14">
          <SectionHeader
            title="New Arrivals"
            subtitle="Fresh finds just added"
            href="/search?sort=newest"
          />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {newest.items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>

        <section className="dn-container pb-16 pt-6">
          <SectionHeader title="All Deals" subtitle="Keep scrolling — more every day" />
          <InfiniteProductFeed initial={feed} />
        </section>
      </div>
  );
}
