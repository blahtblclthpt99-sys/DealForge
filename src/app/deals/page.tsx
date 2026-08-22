import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Flame, Search, ShieldCheck } from "lucide-react";
import { InfiniteProductFeed } from "@/components/infinite-feed";
import { queryProducts } from "@/lib/products";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Deal Watch",
  description: "Fresh retailer offers when verified, plus popular products worth checking when live deal pricing is unavailable.",
};

export default async function DealsPage() {
  const currentDeals = await queryProducts({
    flash: true,
    page: 1,
    limit: 24,
    sort: "popularity",
  });
  const hasCurrentDeals = currentDeals.total > 0;
  const feed = hasCurrentDeals
    ? currentDeals
    : await queryProducts({ page: 1, limit: 24, sort: "popularity" });
  const query = hasCurrentDeals ? { flash: "1", sort: "popularity" } : { sort: "popularity" };

  return (
    <div>
      <section className="border-b border-card-border bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,.12),transparent_38%)]">
        <div className="dn-container py-10 sm:py-12 md:py-14">
          <div className="max-w-4xl">
            <div className="dn-eyebrow"><Flame className="h-3.5 w-3.5" /> {hasCurrentDeals ? "Deal watch" : "Price watch"}</div>
            <h1 className="mt-4 font-display text-4xl font-semibold tracking-[-0.035em] text-forest-ink sm:text-5xl md:text-6xl">
              {hasCurrentDeals ? "Fresh offers worth checking." : "Popular products worth checking today."}
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-forest-muted md:text-lg">
              {hasCurrentDeals
                ? "These products currently have a trusted fresh offer signal. The retailer still controls the final price, availability, shipping, and checkout terms."
                : "No Amazon offer currently meets DealForge’s fresh-price standard, so this page is showing popular products instead of presenting old discounts as live deals. Open the retailer listing for today’s terms."}
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/search" className="dn-button-primary">
                Find a product <Search className="h-4 w-4" />
              </Link>
              <Link href="/categories" className="dn-button-secondary">
                Browse categories <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="mt-6 inline-flex items-start gap-2 rounded-xl border border-card-border bg-card/70 px-3.5 py-3 text-xs leading-5 text-forest-muted shadow-sm">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-forest" />
              <span>DealForge labels price freshness and does not treat an unverified recorded amount as a current retailer price.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="dn-container dn-section">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-forest">{feed.total.toLocaleString()} products</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-forest-ink sm:text-3xl">
              {hasCurrentDeals ? "Current Deal Watch results" : "Popular products to compare"}
            </h2>
          </div>
        </div>
        <InfiniteProductFeed initial={feed} query={query} />
      </section>
    </div>
  );
}
