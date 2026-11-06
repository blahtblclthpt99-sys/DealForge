import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readShopifyCatalogPage, ShopifyAdminError } from "@/lib/shopify-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireOwner() {
  const session = await requireAdmin();
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, email: true, role: true },
  });
  const ownerEmail = process.env.PRODUCT_ENGINE_OWNER_EMAIL?.trim().toLowerCase();
  if (!user || user.role !== "admin" || !ownerEmail || user.email.toLowerCase() !== ownerEmail) {
    throw new Error("FORBIDDEN");
  }
  return user;
}

function authResponse(error: unknown) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (error instanceof Error && error.message === "FORBIDDEN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function GET(req: Request) {
  try {
    await requireOwner();
    const url = new URL(req.url);
    const after = url.searchParams.get("after");
    if (after && after.length > 512) {
      return NextResponse.json({ error: "Invalid pagination cursor" }, { status: 400 });
    }
    const result = await readShopifyCatalogPage(after, 50);
    const products = result.products.map((product) => ({
      externalProductId: product.id,
      title: product.title,
      handle: product.handle,
      vendor: product.vendor,
      productType: product.productType,
      status: product.status,
      tags: product.tags,
      updatedAt: product.updatedAt,
      image: product.featuredMedia?.preview?.image ?? null,
      variantsMayBeIncomplete: product.variants.pageInfo.hasNextPage,\n      variants: product.variants.edges.map(({ node }) => ({
        externalVariantId: node.id,
        title: node.title,
        sku: node.sku,
        supplierListedPrice: node.price,
        observedInventoryQuantity: node.inventoryQuantity,
        unitCost: node.inventoryItem?.unitCost ?? null,
      })),
      sourceVerification: "unverified",
      commerceEnabled: false,
    }));
    return NextResponse.json({
      shopDomain: result.shopDomain,
      fetchedAt: result.fetchedAt,
      count: products.length,
      products,
      pageInfo: result.pageInfo,
      mode: "read_only_preview",
      note: "Catalog preview only. Import, supplier resale permission, current inventory freshness, landed cost, and Stripe certification are separate launch gates.",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const auth = authResponse(error);
    if (auth) return auth;
    if (error instanceof ShopifyAdminError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "Shopify catalog preview unavailable" }, { status: 500 });
  }
}
