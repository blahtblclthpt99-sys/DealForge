import Link from "next/link";
import { ArrowUpRight, Flame, ShieldCheck } from "lucide-react";
import { ProductImage } from "@/components/product-image";
import type { ProductDTO } from "@/lib/products";
import { getCommerceDisplayState, retailerLabel } from "@/lib/commerce-display";
import { formatPrice } from "@/lib/utils";

export function AffiliateSpotlight({ product }: { product: ProductDTO }) {
  const commerce = getCommerceDisplayState(product);
  const retailer = retailerLabel(product.retailer);

  return (
    <aside className="dn-container py-4" aria-label="Affiliate spotlight">
      <div className="dn-forge-glow relative overflow-hidden rounded-[1.4rem] border border-[#F97316]/25 bg-[#111112] text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_25%,rgba(249,115,22,.2),transparent_36%)]" />
        <div className="relative grid items-center gap-6 p-5 sm:p-7 md:grid-cols-[1fr_220px] md:p-8">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#F97316]/30 bg-[#F97316]/10 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.15em] text-[#FB923C]">
              <Flame className="h-3.5 w-3.5" /> Forge Pick · affiliate
            </div>
            <h2 className="mt-4 max-w-2xl font-display text-2xl font-semibold leading-tight text-white md:text-3xl">
              {product.title}
            </h2>
            <p className="mt-2 text-sm text-white/55">
              {product.brand} · {retailer}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {commerce.canDisplayPrice ? (
                <span className="text-2xl font-extrabold text-[#FB923C]">{formatPrice(product.price)}</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-white/75">
                  <ShieldCheck className="h-4 w-4 text-[#FB923C]" /> Check current price on {retailer}
                </span>
              )}
              <a
                href={`/go/${product.id}`}
                target="_blank"
                rel="noopener noreferrer sponsored nofollow"
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#F97316] px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_24px_rgba(249,115,22,.25)] transition hover:bg-[#EA580C]"
              >
                View offer <ArrowUpRight className="h-4 w-4" />
              </a>
              <Link
                href={`/product/${product.slug}`}
                className="text-sm font-semibold text-white/55 hover:text-white"
              >
                Product details
              </Link>
            </div>
            <p className="mt-3 max-w-xl text-[10px] leading-relaxed text-white/35">
              Affiliate link. DealForge may earn a commission from qualifying purchases. Final price and availability are set by the retailer.
            </p>
          </div>
          <Link
            href={`/product/${product.slug}`}
            className="mx-auto block w-full max-w-[220px] overflow-hidden rounded-2xl border border-white/10 bg-white"
          >
            <ProductImage
              src={product.images[0]}
              alt={product.title}
              asin={product.asin}
              className="aspect-square w-full object-contain p-4"
            />
          </Link>
        </div>
      </div>
    </aside>
  );
}
