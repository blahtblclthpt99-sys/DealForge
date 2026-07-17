import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Star } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { BuyButton } from "@/components/buy-button";
import { WishlistButton } from "@/components/wishlist-button";
import { ProductImage } from "@/components/product-image";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getProductBySlug,
  getRelatedProducts,
  getSimilarProducts,
  recordProductView,
} from "@/lib/products";
import { parseJson, formatPrice, discountLabel } from "@/lib/utils";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Product" };
  return {
    title: product.title,
    description: product.description.slice(0, 160),
    openGraph: {
      title: product.title,
      description: product.description.slice(0, 160),
      images: product.images[0] ? [product.images[0]] : [],
    },
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  await recordProductView(product.id);

  const session = await readSession();
  let wishlist: string[] = [];
  if (session) {
    const user = await prisma.user.findUnique({ where: { id: session.id } });
    if (user) {
      wishlist = parseJson<string[]>(user.wishlist, []);
      const recent = parseJson<string[]>(user.recentlyViewed, []).filter((id) => id !== product.id);
      recent.unshift(product.id);
      await prisma.user.update({
        where: { id: user.id },
        data: { recentlyViewed: JSON.stringify(recent.slice(0, 40)) },
      });
    }
  }

  const [similar, related] = await Promise.all([
    getSimilarProducts(product),
    getRelatedProducts(product),
  ]);

  const save = discountLabel(product.discountPercent);

  return (
    <div className="dn-container py-10">
      <div className="grid gap-10 lg:grid-cols-2">
        <div className="dn-card overflow-hidden">
          <ProductImage
            src={product.images[0]}
            alt={product.title}
            priority
            className="aspect-square w-full object-contain p-6"
          />
          {product.images.length > 1 && (
            <div className="grid grid-cols-4 gap-2 p-3">
              {product.images.slice(0, 4).map((img) => (
                <ProductImage
                  key={img}
                  src={img}
                  alt=""
                  className="aspect-square rounded-lg object-contain p-1"
                />
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-forest">{product.brand}</p>
          <h1 className="mt-2 font-display text-3xl font-semibold leading-tight text-forest-ink md:text-4xl">
            {product.title}
          </h1>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1 rounded-full bg-forest/10 px-3 py-1 font-medium text-forest">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              {product.rating.toFixed(1)} · {product.reviewCount.toLocaleString()} reviews
            </span>
            {product.categoryName && (
              <Link
                href={`/categories/${product.categorySlug}`}
                className="rounded-full border border-card-border px-3 py-1 text-forest-muted hover:text-forest"
              >
                {product.categoryName}
              </Link>
            )}
            {product.categorySlug === "clothing" && product.subcategory && (
              <Link
                href={`/categories/clothing?subcategory=${product.subcategory}`}
                className="rounded-full border border-card-border px-3 py-1 capitalize text-forest-muted hover:text-forest"
              >
                {product.subcategory}
              </Link>
            )}
            <span className="rounded-full border border-card-border px-3 py-1 capitalize text-forest-muted">
              {product.availability.replace("_", " ")}
            </span>
          </div>

          <div className="mt-6 flex items-end gap-3">
            <p className="text-4xl font-bold text-forest">{formatPrice(product.price)}</p>
            {product.originalPrice > product.price && (
              <p className="pb-1 text-lg text-forest-muted line-through">
                {formatPrice(product.originalPrice)}
              </p>
            )}
            {save && (
              <span className="mb-1 rounded-full bg-forest px-2.5 py-1 text-xs font-semibold text-white">
                {save}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-forest-muted/70">
            Price as of {new Date(product.lastUpdated).toLocaleDateString()}
          </p>

          <p className="mt-6 text-sm leading-relaxed text-forest-muted">{product.description}</p>

          <div className="mt-8 flex flex-wrap gap-3">
            <BuyButton productId={product.id} retailer={product.retailer} />
            <WishlistButton productId={product.id} initial={wishlist.includes(product.id)} />
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-forest-muted/60">
            {product.retailer === "ebay"
              ? "Outbound link may earn DealForge a commission."
              : product.retailer === "aliexpress"
                ? "Outbound link may earn DealForge a commission."
                : "Outbound Amazon link may earn DealForge a commission."}
          </p>

          {Object.keys(product.specifications).length > 0 && (
            <div className="mt-10">
              <h2 className="font-display text-xl font-semibold text-forest-ink">Specifications</h2>
              <dl className="mt-4 divide-y divide-card-border rounded-2xl border border-card-border bg-card">
                {Object.entries(product.specifications).map(([k, v]) => (
                  <div key={k} className="grid grid-cols-2 gap-2 px-4 py-3 text-sm">
                    <dt className="text-forest-muted">{k}</dt>
                    <dd className="font-medium text-forest-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          <a
            href={`/go/${product.id}`}
            target="_blank"
            rel="noopener noreferrer sponsored nofollow"
            className="mt-6 inline-flex items-center gap-2 text-sm text-forest hover:underline"
          >
            View listing <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      <section className="mt-16">
        <h2 className="font-display text-2xl font-semibold text-forest-ink">Similar products</h2>
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {similar.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>

      <section className="mt-16 mb-8">
        <h2 className="font-display text-2xl font-semibold text-forest-ink">Related products</h2>
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {related.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>
    </div>
  );
}
