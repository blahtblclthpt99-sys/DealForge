import type { Metadata } from "next";
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
    <div className="dn-container py-10 md:py-14">
      <div className="max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-forest">
          {hasCurrentDeals ? "Deal watch" : "Price watch"}
        </p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-forest-ink md:text-5xl">
          {hasCurrentDeals ? "Fresh offers worth checking" : "Popular products to check today"}
        </h1>
        <p className="mt-3 leading-7 text-forest-muted">
          {hasCurrentDeals
            ? "These products currently have a trusted fresh offer signal. The retailer still controls the final price and availability at checkout."
            : "No Amazon offer currently meets DealForge’s fresh-price standard, so this page is showing popular products instead of pretending old discounts are live deals. Open the retailer listing for today’s price and availability."}
        </p>
      </div>
      <div className="mt-10">
        <InfiniteProductFeed initial={feed} query={query} />
      </div>
    </div>
  );
}
