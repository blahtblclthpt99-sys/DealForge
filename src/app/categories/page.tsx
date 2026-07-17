import type { Metadata } from "next";
import { CategoryGrid } from "@/components/category-grid";
import { getCategories } from "@/lib/products";

export const metadata: Metadata = {
  title: "Categories",
  description: "Browse DealForge categories from electronics to outdoor gear.",
};

export default async function CategoriesPage() {
  const categories = await getCategories();
  return (
    <div className="dn-container py-12">
      <h1 className="font-display text-4xl font-semibold text-forest-ink">Categories</h1>
      <p className="mt-2 max-w-2xl text-forest-muted">
        Explore products across every major shopping aisle. Each category is curated for strong
        discounts, ratings, and fresh arrivals.
      </p>
      <div className="mt-10">
        <CategoryGrid categories={categories} />
      </div>
    </div>
  );
}
