import { prisma } from "../src/lib/db";
import { prepareCommercialization } from "../src/lib/commercialization";
import { CERTIFICATION_CATALOG_PRODUCT_IDS } from "../src/lib/certification-catalog";

type Fixture = {
  id: (typeof CERTIFICATION_CATALOG_PRODUCT_IDS)[number];
  slug: string;
  title: string;
  description: string;
  brand: string;
  category: { id: string; slug: string; name: string; icon: string };
  subcategory: string;
  role: "main" | "addon";
  landedCostCents: number;
  sellingPriceCents: number;
};

const FIXTURES: readonly Fixture[] = [
  {
    id: "cert_catalog_home_main_20260825",
    slug: "certification-home-main-20260825",
    title: "Certification Home Essentials Bundle",
    description: "Internal DealForge transaction-certification fixture. Not a real retail listing.",
    brand: "DealForge Certification",
    category: { id: "cert_category_home", slug: "certification-home", name: "Certification Home", icon: "home" },
    subcategory: "Certification Home",
    role: "main",
    landedCostCents: 1_800,
    sellingPriceCents: 2_499,
  },
  {
    id: "cert_catalog_home_addon_1_20260825",
    slug: "certification-home-addon-1-20260825",
    title: "Certification Home Add-on A",
    description: "Internal DealForge transaction-certification fixture. Not a real retail listing.",
    brand: "DealForge Certification",
    category: { id: "cert_category_home", slug: "certification-home", name: "Certification Home", icon: "home" },
    subcategory: "Certification Home",
    role: "addon",
    landedCostCents: 250,
    sellingPriceCents: 549,
  },
  {
    id: "cert_catalog_home_addon_2_20260825",
    slug: "certification-home-addon-2-20260825",
    title: "Certification Home Add-on B",
    description: "Internal DealForge transaction-certification fixture. Not a real retail listing.",
    brand: "DealForge Certification",
    category: { id: "cert_category_home", slug: "certification-home", name: "Certification Home", icon: "home" },
    subcategory: "Certification Home",
    role: "addon",
    landedCostCents: 350,
    sellingPriceCents: 699,
  },
  {
    id: "cert_catalog_auto_main_20260825",
    slug: "certification-auto-main-20260825",
    title: "Certification Auto Essentials Bundle",
    description: "Internal DealForge transaction-certification fixture. Not a real retail listing.",
    brand: "DealForge Certification",
    category: { id: "cert_category_auto", slug: "certification-auto", name: "Certification Auto", icon: "car" },
    subcategory: "Certification Auto",
    role: "main",
    landedCostCents: 2_200,
    sellingPriceCents: 2_999,
  },
  {
    id: "cert_catalog_auto_addon_1_20260825",
    slug: "certification-auto-addon-1-20260825",
    title: "Certification Auto Add-on A",
    description: "Internal DealForge transaction-certification fixture. Not a real retail listing.",
    brand: "DealForge Certification",
    category: { id: "cert_category_auto", slug: "certification-auto", name: "Certification Auto", icon: "car" },
    subcategory: "Certification Auto",
    role: "addon",
    landedCostCents: 200,
    sellingPriceCents: 499,
  },
  {
    id: "cert_catalog_office_main_20260825",
    slug: "certification-office-main-20260825",
    title: "Certification Office Essentials Bundle",
    description: "Internal DealForge transaction-certification fixture. Not a real retail listing.",
    brand: "DealForge Certification",
    category: { id: "cert_category_office", slug: "certification-office", name: "Certification Office", icon: "briefcase" },
    subcategory: "Certification Office",
    role: "main",
    landedCostCents: 800,
    sellingPriceCents: 1_299,
  },
  {
    id: "cert_catalog_office_addon_1_20260825",
    slug: "certification-office-addon-1-20260825",
    title: "Certification Office Add-on A",
    description: "Internal DealForge transaction-certification fixture. Not a real retail listing.",
    brand: "DealForge Certification",
    category: { id: "cert_category_office", slug: "certification-office", name: "Certification Office", icon: "briefcase" },
    subcategory: "Certification Office",
    role: "addon",
    landedCostCents: 100,
    sellingPriceCents: 399,
  },
] as const;

function explicitTrue(name: string) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function assertInstallAuthorized() {
  if (!explicitTrue("CERTIFICATION_CATALOG_ONLY")) {
    throw new Error("CERTIFICATION_CATALOG_ONLY_MUST_BE_EXPLICIT_TRUE");
  }
  if (!(process.env.STRIPE_SECRET_KEY || "").trim().startsWith("sk_test_")) {
    throw new Error("CERTIFICATION_FIXTURES_REQUIRE_STRIPE_TEST_MODE");
  }
  if (!explicitTrue("CERTIFICATION_FIXTURE_WRITE")) {
    throw new Error("CERTIFICATION_FIXTURE_WRITE_NOT_ENABLED");
  }
}

function certificationSpecifications(fixture: Fixture, now: Date) {
  const prepared = prepareCommercialization(
    "{}",
    {
      supplierName: "DealForge Certification Fixture",
      sourceClass: "manufacturer",
      sourceUrl: null,
      resaleAllowed: true,
      sourceVerifiedAt: now.toISOString(),
      priceVerifiedAt: now.toISOString(),
      itemCostCents: fixture.landedCostCents,
      shippingCents: 0,
      taxCents: 0,
      supplierFeeCents: 0,
      handlingCents: 0,
      acquisitionReserveCents: 0,
      sellingPriceCents: fixture.sellingPriceCents,
      inventoryConfidenceBps: 10_000,
      availability: "in_stock",
      taxClassification: "DealForge certification tangible fixture",
      stripeTaxCode: "txcd_99999999",
      taxVerifiedAt: now.toISOString(),
      taxVerificationSource: "dealforge_certification_fixture",
      taxMaxAgeDays: 365,
    },
    now.getTime(),
  );
  const root = JSON.parse(prepared.specifications) as Record<string, unknown>;
  root.internalCertification = true;
  root.certificationCatalog = true;
  root.certificationRole = fixture.role;
  root.certificationFixtureVersion = "2026-08-25-v1";
  return JSON.stringify(root);
}

function recognizedExistingFixture(product: { slug: string; specifications: string }, fixture: Fixture) {
  if (product.slug !== fixture.slug) return false;
  try {
    const root = JSON.parse(product.specifications) as Record<string, unknown>;
    return root.internalCertification === true && root.certificationCatalog === true;
  } catch {
    return false;
  }
}

async function main() {
  assertInstallAuthorized();
  const now = new Date();

  const existing = await prisma.product.findMany({
    where: { id: { in: [...CERTIFICATION_CATALOG_PRODUCT_IDS] } },
    select: { id: true, slug: true, specifications: true },
  });
  const existingById = new Map(existing.map((product) => [product.id, product]));

  for (const fixture of FIXTURES) {
    const current = existingById.get(fixture.id);
    if (current && !recognizedExistingFixture(current, fixture)) {
      throw new Error(`CERTIFICATION_FIXTURE_ID_COLLISION:${fixture.id}`);
    }

    const category = await prisma.category.upsert({
      where: { slug: fixture.category.slug },
      update: {},
      create: fixture.category,
      select: { id: true },
    });
    const specifications = certificationSpecifications(fixture, now);
    const canonicalData = {
      title: fixture.title,
      description: fixture.description,
      brand: fixture.brand,
      categoryId: category.id,
      subcategory: fixture.subcategory,
      images: JSON.stringify(["/images/placeholder-product.svg"]),
      quantity: 1,
      price: fixture.sellingPriceCents / 100,
      originalPrice: fixture.sellingPriceCents / 100,
      discountPercent: 0,
      rating: 0,
      reviewCount: 0,
      affiliateUrl: "",
      retailer: "dealforge-test",
      availability: "in_stock",
      specifications,
      priceSource: "dealforge_certification_fixture",
      priceVerifiedAt: now,
      metadataSource: "dealforge_certification_fixture",
      metadataVerifiedAt: now,
      trendingScore: 0,
      isFeatured: fixture.role === "main",
      isFlashDeal: false,
      commerceEnabled: true,
      sellingPriceCents: fixture.sellingPriceCents,
      landedCostCents: fixture.landedCostCents,
      currency: "usd",
      lastUpdated: now,
    } as const;

    if (current) {
      await prisma.product.update({ where: { id: fixture.id }, data: canonicalData });
    } else {
      await prisma.product.create({
        data: {
          id: fixture.id,
          asin: null,
          slug: fixture.slug,
          createdAt: now,
          ...canonicalData,
        },
      });
    }
  }

  const installed = await prisma.product.count({
    where: { id: { in: [...CERTIFICATION_CATALOG_PRODUCT_IDS] } },
  });
  if (installed !== CERTIFICATION_CATALOG_PRODUCT_IDS.length) {
    throw new Error(`CERTIFICATION_FIXTURE_INSTALL_INCOMPLETE:${installed}`);
  }
  console.log(`Certification catalog ready: ${installed}/${CERTIFICATION_CATALOG_PRODUCT_IDS.length}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });