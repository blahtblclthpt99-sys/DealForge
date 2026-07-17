import Link from "next/link";
import { redirect } from "next/navigation";
import { ProductCard } from "@/components/product-card";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { toProductDTO } from "@/lib/products";
import { parseJson } from "@/lib/utils";

export default async function WishlistPage() {
  const session = await readSession();
  if (!session) redirect("/login?next=/dashboard/wishlist");
  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) redirect("/login");
  const ids = parseJson<string[]>(user.wishlist, []);
  const products = ids.length
    ? await prisma.product.findMany({
        where: { id: { in: ids } },
        include: { category: true },
      })
    : [];
  const ordered = ids
    .map((id) => products.find((p) => p.id === id))
    .filter(Boolean)
    .map((p) => toProductDTO(p!));

  return (
    <div className="dn-container py-12">
      <Link href="/dashboard" className="text-sm text-forest hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-3 font-display text-3xl font-semibold text-forest-ink">Wishlist</h1>
      <p className="mt-2 text-forest-muted">{ordered.length} saved products</p>
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        {ordered.map((p) => (
          <ProductCard key={p.id} product={p} wishlisted />
        ))}
      </div>
      {ordered.length === 0 && (
        <p className="mt-10 text-center text-forest-muted">
          Your nest is empty.{" "}
          <Link href="/search" className="text-forest hover:underline">
            Discover products
          </Link>
        </p>
      )}
    </div>
  );
}
