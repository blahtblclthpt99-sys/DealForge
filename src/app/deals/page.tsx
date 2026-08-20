import type { Metadata } from "next";
import { InfiniteProductFeed } from "@/components/infinite-feed";
import { queryProducts } from "@/lib/products";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Deal Watch",
  description: "Products DealForge is watching for savings. Verify current Amazon prices at checkout.",
};

export default async function DealsPage() {
  const feed = await queryProducts({ flash: true, page: 1, limit: 24, sort: "popularity" });
  return (
    <div className="dn-container py-10 md:py-14">
      <div className="max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-forest">Deal watch</p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-forest-ink md:text-5xl">
          Products flagged for savings
        </h1>
        <p className="mt-3 leading-7 text-forest-muted">
          Amazon offers can change quickly. DealForge only shows an exact Amazon price when it has a fresh approved price check; otherwise use the retailer link for the current offer.
        </p>
      </div>
      <div className="mt-10">
        <InfiniteProductFeed initial={feed} query={{ flash: "1", sort: "popularity" }} />
      </div>
    </div>
  );
}
