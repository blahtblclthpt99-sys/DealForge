import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Grid2X2, Search, ShieldCheck } from "lucide-react";
import { CategoryGrid } from "@/components/category-grid";
import { getCategories } from "@/lib/products";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Categories",
  description: "Browse DealForge product categories and move quickly into the products you want to compare.",
};

export default async function CategoriesPage() {
  const categories = await getCategories();

  return (
    <div>
      <section className="border-b border-card-border bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,.11),transparent_38%)]">
        <div className="dn-container py-10 sm:py-12 md:py-14">
          <div className="max-w-4xl">
            <div className="dn-eyebrow"><Grid2X2 className="h-3.5 w-3.5" /> Browse categories</div>
            <h1 className="mt-4 font-display text-4xl font-semibold tracking-[-0.035em] text-forest-ink sm:text-5xl md:text-6xl">
              Get to the right aisle faster.
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-forest-muted md:text-lg">
              Explore the DealForge catalog by category, then narrow by brand or product intent. Pricing and availability are shown according to their verification state rather than assuming an old offer is still current.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/search" className="dn-button-primary">
                Search all products <Search className="h-4 w-4" />
              </Link>
              <Link href="/deals" className="dn-button-secondary">
                Open Deal Watch <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="dn-container dn-section">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-forest">{categories.length} categories</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-forest-ink sm:text-3xl">Choose where to start</h2>
          </div>
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-forest-muted">
            <ShieldCheck className="h-4 w-4 text-forest" /> Retailer terms remain the source of truth
          </div>
        </div>
        <CategoryGrid categories={categories} />
      </section>
    </div>
  );
}
