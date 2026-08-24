import type { ProductDTO } from "@/lib/products";

export const PUBLIC_STOCK_FRESHNESS_MS = 48 * 60 * 60 * 1000;

export function isInternalCertificationProduct(product: ProductDTO) {
  const flagged = String(product.specifications.internalCertification ?? "").toLowerCase() === "true";
  const reservedId = product.id.startsWith("cert_");
  const reservedTitle = /authorized test only|stripe certification|payment certification/i.test(product.title);
  return flagged || reservedId || reservedTitle;
}

export function isPublicCatalogProduct(product: ProductDTO) {
  return !isInternalCertificationProduct(product) && product.availability !== "out_of_stock";
}

export function hasFreshVerifiedStock(product: ProductDTO, nowMs = Date.now()) {
  if (product.purchaseMode === "direct" && product.commerceReady && product.availability === "in_stock") {
    return true;
  }
  if (!product.availabilityVerified || product.availability !== "in_stock") return false;
  const updatedAt = Date.parse(product.lastUpdated);
  if (!Number.isFinite(updatedAt)) return false;
  const ageMs = nowMs - updatedAt;
  return ageMs >= 0 && ageMs <= PUBLIC_STOCK_FRESHNESS_MS;
}

export function publicCatalogItems(items: ProductDTO[]) {
  return items.filter(isPublicCatalogProduct);
}
