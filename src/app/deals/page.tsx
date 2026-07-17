import type { Metadata } from "next";
import { InfiniteProductFeed } from "@/components/infinite-feed";
import { queryProducts } from "@/lib/products";

export const metadata: Metadata = {
  title: "Flash Deals",
  description: "Limited-time flash deals curated by DealForge.",
};

export default async function DealsPage() {
  const feed = await queryProducts({ flash: true, page: 1, limit: 24, sort: "savings" });
  return (
    <div className="dn-container py-12">
      <h1 className="font-display text-4xl font-semibold text-forest-ink">Flash Deals</h1>
      <p className="mt-2 text-forest-muted">Limited-time drops — prices and stock can change quickly.</p>
      <div className="mt-10">
        <InfiniteProductFeed initial={feed} query={{ flash: "1", sort: "savings" }} />
      </div>
    </div>
  );
}
