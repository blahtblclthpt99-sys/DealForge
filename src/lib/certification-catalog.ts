export const CERTIFICATION_CATALOG_PRODUCT_IDS = [
  "cert_catalog_home_main_20260825",
  "cert_catalog_home_addon_1_20260825",
  "cert_catalog_home_addon_2_20260825",
  "cert_catalog_auto_main_20260825",
  "cert_catalog_auto_addon_1_20260825",
  "cert_catalog_office_main_20260825",
  "cert_catalog_office_addon_1_20260825",
] as const;

export const LEGACY_STRIPE_CERTIFICATION_PRODUCT_ID = "cert_test_75c_20260822_v2";

const certificationCatalogIds = new Set<string>(CERTIFICATION_CATALOG_PRODUCT_IDS);

function explicitBoolean(name: string) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return null;
}

/**
 * Production defaults to the tiny certification catalog until the owner
 * explicitly reopens the normal catalog. Development/test remain unchanged
 * unless CERTIFICATION_CATALOG_ONLY is explicitly enabled.
 */
export function isCertificationCatalogMode() {
  const configured = explicitBoolean("CERTIFICATION_CATALOG_ONLY");
  if (configured !== null) return configured;
  return process.env.NODE_ENV === "production";
}

export function isStripeTestMode() {
  return (process.env.STRIPE_SECRET_KEY || "").trim().startsWith("sk_test_");
}

export function isCertificationTransactionMode() {
  return isCertificationCatalogMode() && isStripeTestMode();
}

export function isCertificationCatalogId(productId: string) {
  return certificationCatalogIds.has(productId);
}

export function isCertificationCatalogProduct(product: { id: string; specifications: string }) {
  if (!isCertificationCatalogId(product.id)) return false;
  try {
    const root = JSON.parse(product.specifications) as Record<string, unknown>;
    return root.internalCertification === true && root.certificationCatalog === true;
  } catch {
    return false;
  }
}

export function isLegacyStripeCertificationProduct(product: { id: string; specifications: string }) {
  if (product.id !== LEGACY_STRIPE_CERTIFICATION_PRODUCT_ID) return false;
  try {
    const root = JSON.parse(product.specifications) as Record<string, unknown>;
    return root.internalCertification === true;
  } catch {
    return false;
  }
}

export function certificationCatalogScopeKey() {
  return isCertificationCatalogMode() ? "certification-v1" : "public-v1";
}
