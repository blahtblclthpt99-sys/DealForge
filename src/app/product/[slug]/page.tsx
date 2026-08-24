import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock3, ShieldCheck, Star } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { BuyButton } from "@/components/buy-button";
import { WishlistButton } from "@/components/wishlist-button";
import { ProductImage } from "@/components/product-image";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getProductBySlug, getRelatedProducts, getSimilarProducts, recordProductView } from "@/lib/products";
import { hasFreshVerifiedStock, isInternalCertificationProduct, publicCatalogItems } from "@/lib/public-catalog";
import { parseJson, formatPrice, discountLabel } from "@/lib/utils";
import { formatQuantityLabel } from "@/lib/quantity";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product || isInternalCertificationProduct(product)) return { title: "Product" };
  return {
    title: product.title,
    description: product.description.slice(0, 160),
    openGraph: { title: product.title, description: product.description.slice(0, 160), images: product.images[0] ? [product.images[0]] : [] },
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product || isInternalCertificationProduct(product)) notFound();
  await recordProductView(product.id);

  const session = await readSession();
  let wishlist: string[] = [];
  if (session) {
    const user = await prisma.user.findUnique({ where: { id: session.id } });
    if (user) {
      wishlist = parseJson<string[]>(user.wishlist, []);
      const recent = parseJson<string[]>(user.recentlyViewed, []).filter((id) => id !== product.id);
      recent.unshift(product.id);
      await prisma.user.update({ where: { id: user.id }, data: { recentlyViewed: JSON.stringify(recent.slice(0, 40)) } });
    }
  }

  const [similarRows, relatedRows] = await Promise.all([getSimilarProducts(product), getRelatedProducts(product)]);
  const similar = publicCatalogItems(similarRows);
  const related = publicCatalogItems(relatedRows);
  const direct = product.purchaseMode === "direct" && product.commerceReady;
  const amazonUnverified = !direct && product.retailer === "amazon" && !product.priceVerified;
  const save = amazonUnverified ? null : discountLabel(product.discountPercent);
  const qnty = formatQuantityLabel(product.quantity);
  const freshInStock = hasFreshVerifiedStock(product);
  const unavailable = product.availabilityVerified && product.availability === "out_of_stock";

  return (
    <div className="dn-container py-8 md:py-10">
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-10">
        <div className="dn-card overflow-hidden">
          <ProductImage src={product.images[0]} alt={product.title} asin={product.asin} priority className="aspect-square w-full object-contain p-6" />
          {product.images.length > 1 && <div className="grid grid-cols-4 gap-2 p-3">{product.images.slice(0, 4).map((img) => <ProductImage key={img} src={img} asin={product.asin} alt="" className="aspect-square rounded-lg object-contain p-1" />)}</div>}
        </div>

        <div className="min-w-0">
          <p className="text-sm font-medium uppercase tracking-wide text-forest">{product.brand}</p>
          <h1 className="mt-2 break-words font-display text-3xl font-semibold leading-tight text-forest-ink md:text-4xl">{product.title}</h1>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            {direct && <span className="inline-flex items-center gap-1 rounded-full bg-forest/10 px-3 py-1 font-medium text-forest"><ShieldCheck className="h-3.5 w-3.5" /> Sold by DealForge</span>}
            {freshInStock ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-forest/10 px-3 py-1 font-medium text-forest"><CheckCircle2 className="h-3.5 w-3.5" /> In stock · current</span>
            ) : unavailable ? (
              <span className="rounded-full border border-card-border px-3 py-1 font-medium text-forest-muted">Currently unavailable</span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-card-border px-3 py-1 font-medium text-forest-muted"><Clock3 className="h-3.5 w-3.5" /> Check current availability</span>
            )}
            {product.metadataVerified && product.rating > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-forest/10 px-3 py-1 font-medium text-forest"><Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />{product.rating.toFixed(1)} · {product.reviewCount.toLocaleString()} reviews</span>}
            {qnty && <span className="rounded-full bg-forest px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">{qnty}</span>}
            {product.categoryName && <Link href={`/categories/${product.categorySlug}`} className="rounded-full border border-card-border px-3 py-1 text-forest-muted hover:text-forest">{product.categoryName}</Link>}
          </div>

          {amazonUnverified ? (
            <div className="mt-6 rounded-2xl border border-card-border bg-card p-4"><p className="text-xl font-bold text-forest">Check current price on Amazon</p><p className="mt-1 text-xs leading-relaxed text-forest-muted">Check current availability on the retailer listing. DealForge does not claim a current Amazon price, discount, rating, reviews, or stock without an authorized fresh source.</p></div>
          ) : (
            <>
              <div className="mt-6 flex items-end gap-3"><p className="text-4xl font-bold text-forest">{formatPrice(product.price)}</p>{product.originalPrice > product.price && <p className="pb-1 text-lg text-forest-muted line-through">{formatPrice(product.originalPrice)}</p>}{save && <span className="mb-1 rounded-full bg-forest px-2.5 py-1 text-xs font-semibold text-white">{save}</span>}</div>
              {direct ? <p className="mt-1 text-xs text-forest-muted">DealForge selling price. Supplier economics are revalidated again when checkout starts.</p> : product.priceVerifiedAt ? <p className="mt-1 text-[11px] text-forest-muted/70">Price verified {new Date(product.priceVerifiedAt).toLocaleDateString()}</p> : null}
            </>
          )}

          {qnty && <p className="mt-2 text-sm font-medium text-forest-ink">Pack quantity: <span className="text-forest">{product.quantity?.toLocaleString()}</span></p>}
          <p className="mt-6 text-sm leading-relaxed text-forest-muted">{product.description}</p>

          <div className="mt-8 flex flex-wrap gap-3">
            {!unavailable && <BuyButton productId={product.id} retailer={product.retailer} purchaseMode={product.purchaseMode} customerEmail={session?.email ?? ""} affiliateLabel={amazonUnverified ? "Check current price on Amazon" : "View retailer listing"} />}
            <WishlistButton productId={product.id} initial={wishlist.includes(product.id)} />
          </div>
          {!unavailable && <p className="mt-3 text-[11px] leading-relaxed text-forest-muted/70">{direct ? "Your payment is processed through DealForge secure checkout. Order state is confirmed from verified payment events." : product.retailer === "amazon" ? "Outbound Amazon link may earn DealForge a commission from qualifying purchases." : "The retailer button opens the current source in a new tab."}</p>}

          {Object.keys(product.specifications).length > 0 && <div className="mt-10"><h2 className="font-display text-xl font-semibold text-forest-ink">Product details</h2><dl className="mt-4 divide-y divide-card-border rounded-2xl border border-card-border bg-card">{Object.entries(product.specifications).map(([key, value]) => <div key={key} className="grid grid-cols-2 gap-2 px-4 py-3 text-sm"><dt className="break-words text-forest-muted">{key}</dt><dd className="break-words font-medium text-forest-ink">{value}</dd></div>)}</dl></div>}
        </div>
      </div>

      {similar.length > 0 && <section className="mt-14 md:mt-16"><h2 className="font-display text-2xl font-semibold text-forest-ink">Similar products</h2><div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">{similar.map((item) => <ProductCard key={item.id} product={item} />)}</div></section>}
      {related.length > 0 && <section className="mb-8 mt-14 md:mt-16"><h2 className="font-display text-2xl font-semibold text-forest-ink">More from this brand</h2><div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">{related.map((item) => <ProductCard key={item.id} product={item} />)}</div></section>}
    </div>
  );
}
