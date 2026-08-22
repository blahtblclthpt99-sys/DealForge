import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, Search, ShieldCheck } from "lucide-react";
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
    description: `Browse ${category.name} products on DealForge and verify current retailer terms before purchase.`,
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
    subCounts.map((row) => [row.subcategory!, row._count._all]),
  );
  const selectedLabel = subcategory
    ? CLOTHING_SUBCATEGORIES.find((item) => item.slug === subcategory)?.label
    : null;

  return (
    <div>
      <section className="border-b border-card-border bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,.1),transparent_38%)]">
        <div className="dn-container py-9 sm:py-11 md:py-13">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div className="max-w-3xl">
              <Link href="/categories" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-bold text-forest hover:underline">
                <ArrowLeft className="h-4 w-4" /> All categories
              </Link>
              <p className="mt-4 text-xs font-extrabold uppercase tracking-[0.14em] text-forest">Category</p>
              <h1 className="mt-1 font-display text-4xl font-semibold tracking-[-0.035em] text-forest-ink sm:text-5xl md:text-6xl">
                {category.name}
              </h1>
              <p className="mt-3 text-sm leading-6 text-forest-muted sm:text-base">
                {feed.total.toLocaleString()} available {feed.total === 1 ? "product" : "products"}
                {selectedLabel ? ` in ${selectedLabel}` : " to explore and compare"}.
              </p>
            </div>
            <Link href={`/search?category=${encodeURIComponent(slug)}`} className="dn-button-primary">
              <Search className="h-4 w-4" /> Refine in Product Finder
            </Link>
          </div>

          <div className="mt-5 inline-flex items-start gap-2 rounded-xl border border-card-border bg-card/70 px-3.5 py-3 text-xs leading-5 text-forest-muted shadow-sm">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-forest" />
            <span>Price and availability states are shown according to their verification status; confirm final terms with the retailer.</span>
          </div>
        </div>
      </section>

      <section className="dn-container dn-section">
        {isClothing ? (
          <nav className="mb-8 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Clothing departments">
            <Link
              href="/categories/clothing"
              aria-current={!subcategory ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-bold transition",
                !subcategory
                  ? "border-forest bg-forest text-white"
                  : "border-card-border bg-card text-forest-ink hover:border-forest/40 hover:text-forest",
              )}
            >
              All
            </Link>
            {CLOTHING_SUBCATEGORIES.map((sub) => (
              <Link
                key={sub.slug}
                href={`/categories/clothing?subcategory=${sub.slug}`}
                aria-current={subcategory === sub.slug ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-bold transition",
                  subcategory === sub.slug
                    ? "border-forest bg-forest text-white"
                    : "border-card-border bg-card text-forest-ink hover:border-forest/40 hover:text-forest",
                )}
              >
                {sub.label}
                {countBySub[sub.slug] != null ? (
                  <span className="ml-1.5 opacity-70">({countBySub[sub.slug].toLocaleString()})</span>
                ) : null}
              </Link>
            ))}
          </nav>
        ) : null}

        <InfiniteProductFeed
          key={`${slug}-${subcategory ?? "all"}`}
          initial={feed}
          query={{ category: slug, subcategory }}
        />
      </section>
    </div>
  );
}
