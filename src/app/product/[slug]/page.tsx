import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, ShieldCheck, Star } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { BuyButton } from "@/components/buy-button";
import { WishlistButton } from "@/components/wishlist-button";
import { ProductImage } from "@/components/product-image";
import { AdSlot } from "@/components/ad-slot";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getProductBySlug,
  getRelatedProducts,
  getSimilarProducts,
  recordProductView,
} from "@/lib/products";
import { mutateUserJsonState } from "@/lib/user-json-state";
import { parseJson, formatPrice, discountLabel } from "@/lib/utils";
import { formatQuantityLabel } from "@/lib/quantity";
import { getCommerceDisplayState, retailerLabel } from "@/lib/commerce-display";
import { getAdsenseConfig } from "@/lib/ads";

type Props = { params: Promise<{ slug: string }> };

const INTERNAL_SPEC_KEYS = new Set([
  "source",
  "pricesource",
  "pricecheckedat",
  "observedat",
  "needsenrichment",
  "importsource",
  "storefrontblocked",
  "storefrontblockedreason",
]);

function cleanRecentProductIds(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .filter((id): id is string => typeof id === "string")
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id.length <= 100)
    .slice(0, 40);
}

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
    const user = await prisma.user.findUnique({
      where: { id: session.id },
      select: { wishlist: true },
    });
    if (user) {
      wishlist = parseJson<string[]>(user.wishlist, []);
      await mutateUserJsonState<unknown>(
        session.id,
        "recentlyViewed",
        [],
        (current) => {
          const recent = cleanRecentProductIds(current).filter((id) => id !== product.id);
          return [product.id, ...recent].slice(0, 40);
        },
      );
    }
  }

  const [similar, related] = await Promise.all([
    getSimilarProducts(product),
    getRelatedProducts(product),
  ]);

  const commerce = getCommerceDisplayState(product);
  const save = commerce.canDisplayDiscount ? discountLabel(product.discountPercent) : null;
  const qnty = formatQuantityLabel(product.quantity);
  const retailer = retailerLabel(product.retailer);
  const ads = getAdsenseConfig();
  const publicSpecs = Object.entries(product.specifications).filter(
    ([key]) => !INTERNAL_SPEC_KEYS.has(key.toLowerCase()),
  );

  return (
    <div className="dn-container py-8 md:py-12">
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs text-forest-muted">
        <Link href="/" className="hover:text-forest">Home</Link>
        <span>/</span>
        {product.categoryName ? (
          <Link href={`/categories/${product.categorySlug}`} className="hover:text-forest">
            {product.categoryName}
          </Link>
        ) : null}
        {product.categoryName ? <span>/</span> : null}
        <span className="max-w-[22rem] truncate text-forest-ink">{product.title}</span>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)] lg:gap-12">
        <div className="dn-card overflow-hidden bg-card">
          <div className="relative bg-[radial-gradient(circle_at_50%_20%,color-mix(in_srgb,var(--forest-accent)_14%,transparent),transparent_60%)]">
            <ProductImage
              src={product.images[0]}
              alt={product.title}
              asin={product.asin}
              priority
              className="aspect-square w-full object-contain p-7 md:p-10"
            />
          </div>
          {product.images.length > 1 ? (
            <div className="grid grid-cols-4 gap-2 border-t border-card-border p-3">
              {product.images.slice(0, 4).map((img) => (
                <ProductImage
                  key={img}
                  src={img}
                  asin={product.asin}
                  alt=""
                  className="aspect-square rounded-xl border border-card-border bg-background object-contain p-1"
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-forest/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-forest">
              {retailer}
            </span>
            {commerce.isAmazon && commerce.priceStatus === "recorded" ? (
              <span className="rounded-full border border-card-border bg-card px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-forest-muted">
                Price refresh needed
              </span>
            ) : null}
            {product.categoryName ? (
              <Link
                href={`/categories/${product.categorySlug}`}
                className="rounded-full border border-card-border bg-card px-3 py-1 text-xs text-forest-muted hover:border-forest/40 hover:text-forest"
              >
                {product.categoryName}
              </Link>
            ) : null}
          </div>

          <p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-forest-muted">
            {product.brand || retailer}
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold leading-[1.08] tracking-tight text-forest-ink md:text-5xl">
            {product.title}
          </h1>

          <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
            {product.rating > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 font-medium text-forest-ink shadow-sm ring-1 ring-card-border">
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                {product.rating.toFixed(1)}
                {commerce.reviewCountIsCredible ? ` · ${product.reviewCount.toLocaleString()} reviews` : " rating"}
              </span>
            ) : null}
            {qnty ? (
              <span className="rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-forest-ink shadow-sm ring-1 ring-card-border">
                {qnty}
              </span>
            ) : null}
            {product.categorySlug === "clothing" && product.subcategory ? (
              <Link
                href={`/categories/clothing?subcategory=${product.subcategory}`}
                className="rounded-full bg-card px-3 py-1.5 text-xs capitalize text-forest-muted shadow-sm ring-1 ring-card-border hover:text-forest"
              >
                {product.subcategory}
              </Link>
            ) : null}
          </div>

          <div
            className="mt-7 rounded-2xl border border-card-border bg-card p-5 shadow-sm"
            data-price-display={commerce.canDisplayPrice ? "current" : "retailer-check"}
          >
            {commerce.canDisplayPrice ? (
              <>
                <div className="flex flex-wrap items-end gap-3">
                  <p className="text-4xl font-extrabold tracking-tight text-forest">
                    {formatPrice(product.price)}
                  </p>
                  {commerce.canDisplayDiscount ? (
                    <p className="pb-1 text-lg text-forest-muted line-through">{formatPrice(product.originalPrice)}</p>
                  ) : null}
                  {save ? (
                    <span className="mb-1 rounded-full bg-[#F97316] px-2.5 py-1 text-xs font-bold text-white">
                      {save}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-forest-muted">
                  {commerce.priceCaption}
                </p>
                {commerce.isAmazon ? (
                  <p className="mt-3 text-[11px] leading-relaxed text-forest-muted/80">
                    Amazon prices and availability can change; the amount shown by Amazon when you purchase is the controlling offer.
                  </p>
                ) : null}
              </>
            ) : (
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-forest/10 p-2.5 text-forest">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-bold text-forest-ink">Check current price on {retailer}</p>
                  <p className="mt-1 text-sm leading-relaxed text-forest-muted">
                    {commerce.isAmazon
                      ? "The stored Amazon amount is not fresh enough to publish as a current price. Open Amazon to see today’s price and availability."
                      : "The retailer listing is the source of truth for the current price and availability."}
                  </p>
                </div>
              </div>
            )}
          </div>

          {qnty ? (
            <p className="mt-3 text-sm font-medium text-forest-ink">
              Pack quantity: <span className="text-forest">{product.quantity?.toLocaleString()}</span>
            </p>
          ) : null}

          <p className="mt-6 text-sm leading-7 text-forest-muted">{product.description}</p>

          <div className="mt-8 flex flex-wrap gap-3">
            <BuyButton
              productId={product.id}
              retailer={product.retailer}
              priceNeedsCheck={commerce.priceNeedsCheck}
            />
            <WishlistButton productId={product.id} initial={wishlist.includes(product.id)} />
          </div>

          <p className="mt-3 max-w-xl text-[11px] leading-relaxed text-forest-muted/75">
            Links to retailers may be affiliate links. As an Amazon Associate I earn from qualifying purchases.
          </p>

          {publicSpecs.length > 0 ? (
            <div className="mt-10">
              <h2 className="font-display text-xl font-semibold text-forest-ink">Product details</h2>
              <dl className="mt-4 divide-y divide-card-border overflow-hidden rounded-2xl border border-card-border bg-card">
                {publicSpecs.map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)] gap-3 px-4 py-3 text-sm">
                    <dt className="break-words capitalize text-forest-muted">{k.replace(/([A-Z])/g, " $1")}</dt>
                    <dd className="break-words font-medium text-forest-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          <a
            href={`/go/${product.id}`}
            target="_blank"
            rel="noopener noreferrer sponsored nofollow"
            className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-forest hover:underline"
          >
            Open retailer listing <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      <AdSlot client={ads.client} slot={ads.product} className="mt-12" />

      {similar.length ? (
        <section className="mt-16">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-forest">More to compare</p>
              <h2 className="mt-1 font-display text-2xl font-semibold text-forest-ink">Similar products</h2>
            </div>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            {similar.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      ) : null}

      {related.length ? (
        <section className="mb-8 mt-16">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-forest">Same brand</p>
          <h2 className="mt-1 font-display text-2xl font-semibold text-forest-ink">Related products</h2>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
