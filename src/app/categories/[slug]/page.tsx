import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InfiniteProductFeed } from "@/components/infinite-feed";
import { prisma } from "@/lib/db";
import { queryProducts } from "@/lib/products";
import { CLOTHING_SUBCATEGORIES } from "@/lib/clothing-subcategory";
import { cn } from "@/lib/utils";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ subcategory?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = await prisma.category.findUnique({ where: { slug } });
  if (!category) return { title: "Category" };
  return {
    title: category.name,
    description: `Shop ${category.name} deals and trending products on DealForge.`,
  };
}

export default async function CategoryDetailPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { subcategory: subParam } = await searchParams;
  const category = await prisma.category.findUnique({ where: { slug } });
  if (!category) notFound();

  const isClothing = slug === "clothing";
  const subcategory =
    isClothing && CLOTHING_SUBCATEGORIES.some((c) => c.slug === subParam)
      ? subParam
      : undefined;

  const feed = await queryProducts({
    category: slug,
    subcategory,
    page: 1,
    limit: 24,
  });

  const subCounts = isClothing
    ? await prisma.product.groupBy({
        by: ["subcategory"],
        where: { categoryId: category.id, subcategory: { not: null } },
        _count: { _all: true },
      })
    : [];
  const countBySub = Object.fromEntries(
    subCounts.map((r) => [r.subcategory!, r._count._all]),
  );

  return (
    <div className="dn-container py-12">
      <p className="text-sm font-medium uppercase tracking-wide text-forest">Category</p>
      <h1 className="mt-1 font-display text-4xl font-semibold text-forest-ink">
        {category.name}
      </h1>
      <p className="mt-2 text-forest-muted">
        {feed.total} products
        {subcategory
          ? ` in ${CLOTHING_SUBCATEGORIES.find((c) => c.slug === subcategory)?.label}`
          : " ranked for value and demand"}
      </p>

      {isClothing && (
        <nav
          className="mt-8 flex flex-wrap gap-2"
          aria-label="Clothing departments"
        >
          <Link
            href="/categories/clothing"
            className={cn(
              "rounded-full border px-4 py-2 text-sm font-medium transition",
              !subcategory
                ? "border-forest bg-forest text-white"
                : "border-card-border bg-card text-forest-ink hover:border-forest",
            )}
          >
            All
          </Link>
          {CLOTHING_SUBCATEGORIES.map((sub) => (
            <Link
              key={sub.slug}
              href={`/categories/clothing?subcategory=${sub.slug}`}
              className={cn(
                "rounded-full border px-4 py-2 text-sm font-medium transition",
                subcategory === sub.slug
                  ? "border-forest bg-forest text-white"
                  : "border-card-border bg-card text-forest-ink hover:border-forest",
              )}
            >
              {sub.label}
              {countBySub[sub.slug] != null && (
                <span className="ml-1.5 opacity-70">({countBySub[sub.slug]})</span>
              )}
            </Link>
          ))}
        </nav>
      )}

      <div className="mt-10">
        <InfiniteProductFeed
          key={`${slug}-${subcategory ?? "all"}`}
          initial={feed}
          query={{
            category: slug,
            subcategory,
          }}
        />
      </div>
    </div>
  );
}
