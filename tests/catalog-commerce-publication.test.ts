import assert from "node:assert/strict";
import test from "node:test";
import {
  assessCatalogProductForPublication,
  deriveCatalogSourceSnapshot,
  disabledPublicationSpecifications,
  publicationAuditSpecifications,
} from "../src/lib/catalog-commerce-publication";

const NOW = Date.parse("2026-08-23T02:30:00.000Z");

function product(overrides: Partial<{
  price: number;
  availability: string;
  specifications: string;
  lastUpdated: string;
}> = {}) {
  return {
    id: "product-1",
    price: 10.25,
    availability: "now",
    specifications: JSON.stringify({
      needsEnrichment: false,
      storefrontBlocked: false,
      metadataSource: "amazon-creators-api",
      metadataCheckedAt: "2026-08-23T02:25:00.000Z",
      priceSource: "amazon-creators-api",
      priceCheckedAt: "2026-08-23T02:25:00.000Z",
    }),
    lastUpdated: "2026-08-23T02:25:00.000Z",
    ...overrides,
  };
}

function costs() {
  return {
    shippingCents: 125,
    estimatedTaxCents: 90,
    handlingCents: 35,
    procurementBufferCents: 50,
    otherCostCents: 0,
  };
}

function pricing() {
  return {
    targetGrossMarginBps: 2_000,
    minimumProfitCents: 300,
    paymentFeeBps: 300,
    paymentFixedFeeCents: 30,
    priceCeilingCents: 5_000,
  };
}

test("derives price, freshness, trust and canonical availability only from stored catalog data", () => {
  const source = deriveCatalogSourceSnapshot(product());
  assert.equal(source.itemCostCents, 1_025);
  assert.equal(source.priceSource, "amazon-creators-api");
  assert.equal(source.sourceVerified, true);
  assert.equal(source.sourceAvailable, true);
  assert.equal(source.canonicalAvailability, "in_stock");
  assert.equal(source.sourceCheckedAtMs, Date.parse("2026-08-23T02:25:00.000Z"));
});

test("eligible approved catalog data can produce a publication recommendation", () => {
  const result = assessCatalogProductForPublication({
    financialGateCertified: true,
    product: product(),
    costs: costs(),
    pricing: pricing(),
    nowMs: NOW,
  });
  assert.equal(result.assessment.eligible, true);
  assert.equal(result.assessment.reason, "ELIGIBLE");
  assert.equal(result.assessment.landedCostCents, 1_325);
  assert.ok((result.assessment.recommendedSellingPriceCents || 0) > 1_325);
});

test("unapproved price sources fail closed even when the browser-visible price is populated", () => {
  const result = assessCatalogProductForPublication({
    financialGateCertified: true,
    product: product({
      specifications: JSON.stringify({
        needsEnrichment: false,
        priceSource: "user-batch",
        priceCheckedAt: "2026-08-23T02:25:00.000Z",
      }),
    }),
    costs: costs(),
    pricing: pricing(),
    nowMs: NOW,
  });
  assert.equal(result.assessment.eligible, false);
  assert.equal(result.assessment.reason, "BLOCKED_UNVERIFIED_SOURCE");
});

test("stale approved source data cannot be published", () => {
  const result = assessCatalogProductForPublication({
    financialGateCertified: true,
    product: product({
      specifications: JSON.stringify({
        metadataSource: "amazon-creators-api",
        priceSource: "amazon-creators-api",
        priceCheckedAt: "2026-08-22T19:00:00.000Z",
      }),
    }),
    costs: costs(),
    pricing: pricing(),
    nowMs: NOW,
  });
  assert.equal(result.assessment.eligible, false);
  assert.equal(result.assessment.reason, "BLOCKED_STALE_SOURCE");
});

test("unavailable catalog data cannot be published", () => {
  const result = assessCatalogProductForPublication({
    financialGateCertified: true,
    product: product({ availability: "out_of_stock" }),
    costs: costs(),
    pricing: pricing(),
    nowMs: NOW,
  });
  assert.equal(result.assessment.eligible, false);
  assert.equal(result.assessment.reason, "BLOCKED_UNAVAILABLE");
});

test("the financial certification flag remains a hard publication blocker", () => {
  const result = assessCatalogProductForPublication({
    financialGateCertified: false,
    product: product(),
    costs: costs(),
    pricing: pricing(),
    nowMs: NOW,
  });
  assert.equal(result.assessment.eligible, false);
  assert.equal(result.assessment.reason, "BLOCKED_FINANCIAL_GATE");
});

test("publication audit metadata records the assessed source and disabling preserves the audit", () => {
  const result = assessCatalogProductForPublication({
    financialGateCertified: true,
    product: product(),
    costs: costs(),
    pricing: pricing(),
    nowMs: NOW,
  });
  const published = publicationAuditSpecifications({
    existingSpecifications: product().specifications,
    publishedAt: new Date(NOW).toISOString(),
    source: result.source,
    assessment: result.assessment,
    costs: costs(),
    pricing: pricing(),
  });
  const publishedJson = JSON.parse(published) as Record<string, any>;
  assert.equal(publishedJson.commercePublication.state, "published");
  assert.equal(publishedJson.commercePublication.sourcePriceCents, 1_025);
  assert.equal(publishedJson.commercePublication.priceSource, "amazon-creators-api");

  const disabled = JSON.parse(
    disabledPublicationSpecifications(published, "2026-08-23T02:31:00.000Z"),
  ) as Record<string, any>;
  assert.equal(disabled.commercePublication.state, "disabled");
  assert.equal(disabled.commercePublication.sourcePriceCents, 1_025);
  assert.equal(disabled.commercePublication.disabledAt, "2026-08-23T02:31:00.000Z");
});
