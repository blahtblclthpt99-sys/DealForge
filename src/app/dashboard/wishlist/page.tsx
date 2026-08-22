import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Heart, Search } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicProductWhere } from "@/lib/product-visibility";
import { toProductDTO } from "@/lib/products";
import { parseJson } from "@/lib/utils";

const MAX_WISHLIST_ITEMS = 500;

function cleanIds(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return Array.from(
    new Set(
      value
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim())
        .filter((id) => id.length > 0 && id.length <= 100),
    ),
  ).slice(0, MAX_WISHLIST_ITEMS);
}

export default async function WishlistPage() {
  const session = await readSession();
  if (!session) redirect("/login?next=/dashboard/wishlist");
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { wishlist: true },
  });
  if (!user) redirect("/login");

  const ids = cleanIds(parseJson<unknown>(user.wishlist, []));
  const products = ids.length
    ? await prisma.product.findMany({
        where: publicProductWhere({ id: { in: ids } }),
        include: { category: true },
      })
    : [];
  const byId = new Map(products.map((product) => [product.id, product]));
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((product): product is NonNullable<typeof product> => Boolean(product))
    .map(toProductDTO);

  return (
    <div className="dn-container py-10 sm:py-12 lg:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/dashboard" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-bold text-forest hover:underline">
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>
          <p className="mt-4 text-xs font-extrabold uppercase tracking-[0.14em] text-forest">Saved products</p>
          <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight text-forest-ink sm:text-5xl">Wishlist</h1>
          <p className="mt-2 text-sm leading-6 text-forest-muted">{ordered.length.toLocaleString()} available {ordered.length === 1 ? "product" : "products"} saved to your account.</p>
        </div>
        <Link href="/search" className="dn-button-primary">
          <Search className="h-4 w-4" /> Discover products
        </Link>
      </div>

      {ordered.length > 0 ? (
        <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          {ordered.map((product) => (
            <ProductCard key={product.id} product={product} wishlisted />
          ))}
        </div>
      ) : (
        <section className="dn-card mt-8 px-5 py-12 text-center sm:py-16">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-forest/9 text-forest">
            <Heart className="h-5 w-5" />
          </span>
          <h2 className="mt-4 font-display text-2xl font-semibold text-forest-ink">Nothing saved yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-forest-muted">Use the heart on a product card to keep interesting items here for a faster return visit.</p>
          <Link href="/search" className="dn-button-primary mt-5">
            <Search className="h-4 w-4" /> Find products
          </Link>
        </section>
      )}
    </div>
  );
}
