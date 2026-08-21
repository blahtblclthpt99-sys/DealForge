import Link from "next/link";
import { redirect } from "next/navigation";
import { ProductCard } from "@/components/product-card";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicProductWhere } from "@/lib/product-visibility";
import { toProductDTO } from "@/lib/products";
import { parseJson } from "@/lib/utils";

const MAX_RECENT_ITEMS = 40;

function cleanIds(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return Array.from(
    new Set(
      value
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim())
        .filter((id) => id.length > 0 && id.length <= 100),
    ),
  ).slice(0, MAX_RECENT_ITEMS);
}

export default async function RecentPage() {
  const session = await readSession();
  if (!session) redirect("/login?next=/dashboard/recent");
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { recentlyViewed: true },
  });
  if (!user) redirect("/login");

  const ids = cleanIds(parseJson<unknown>(user.recentlyViewed, []));
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
    <div className="dn-container py-12">
      <Link href="/dashboard" className="text-sm text-forest hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-3 font-display text-3xl font-semibold text-forest-ink">Recently viewed</h1>
      <p className="mt-2 text-forest-muted">Your latest available product views.</p>
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        {ordered.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
      {ordered.length === 0 && (
        <p className="mt-10 text-center text-forest-muted">No recently viewed products yet.</p>
      )}
    </div>
  );
}
