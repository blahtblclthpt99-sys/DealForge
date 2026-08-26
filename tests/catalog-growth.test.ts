import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBundleProposal,
  canonicalIdentifier,
  parseSupplierCsv,
  supplierRowPrice,
} from "../src/lib/catalog-growth";

const observedAt = new Date(Date.now() - 60_000).toISOString();

function csv(rows: string[]) {
  return [
    "supplier_name,supplier_key,source_class,external_id,upc,gtin,mpn,title,brand,category,source_url,image_url,currency,item_cost,shipping,supplier_fee,handling,availability,inventory_confidence_bps,observed_at",
    ...rows,
  ].join("\n");
}

test("supplier CSV parses verified-shaped rows and canonicalizes strongest identifier", () => {
  const rows = parseSupplierCsv(csv([
    `Acme Wholesale,acme,wholesale,SKU-1,123456789012,00012345678905,MPN-1,Desk Lamp,Acme,Home & Kitchen,https://supplier.example/items/sku-1,https://supplier.example/images/sku-1.jpg,usd,10.00,2.00,0.50,0.25,in_stock,9200,${observedAt}`,
  ]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].itemCostCents, 1000);
  assert.equal(rows[0].shippingCents, 200);
  assert.equal(rows[0].supplierFeeCents, 50);
  assert.equal(rows[0].handlingCents, 25);
  assert.equal(canonicalIdentifier(rows[0]), "gtin:00012345678905");
  const price = supplierRowPrice(rows[0]);
  assert.ok(price.recommendedPriceCents > price.landedCostCents);
  assert.ok(price.contributionProfitCents >= price.minimumProfitCents);
});

test("supplier CSV rejects private source hosts and excessive batches", () => {
  assert.throws(() => parseSupplierCsv(csv([
    `Bad,bad,wholesale,1,,,,Bad Item,Bad,Tools,http://127.0.0.1/item,,usd,1,0,0,0,in_stock,9000,${observedAt}`,
  ])), /SOURCE_URL_INVALID/);

  const many = Array.from({ length: 501 }, (_, i) =>
    `Acme,acme,wholesale,SKU-${i},,,,Item ${i},Acme,Tools,https://supplier.example/${i},,usd,1,0,0,0,in_stock,9000,${observedAt}`,
  );
  assert.throws(() => parseSupplierCsv(csv(many)), /CSV_ROW_LIMIT/);
});

test("bundle proposal requires unique compatible components and protects profit", () => {
  const proposal = buildBundleProposal("Desk Setup Bundle", [
    {
      productId: "p1",
      title: "Desk Lamp",
      categoryId: "home",
      currency: "usd",
      landedCostCents: 1000,
      sellingPriceCents: 1999,
      availability: "in_stock",
      priceVerifiedAt: new Date(),
    },
    {
      productId: "p2",
      title: "USB Hub",
      categoryId: "home",
      currency: "usd",
      landedCostCents: 1200,
      sellingPriceCents: 2499,
      availability: "in_stock",
      priceVerifiedAt: new Date(),
    },
  ]);
  assert.equal(proposal.currency, "usd");
  assert.equal(proposal.productIds.length, 2);
  assert.ok(proposal.recommendedPriceCents > proposal.landedCostCents);
  assert.ok(proposal.contributionProfitCents > 0);
  assert.ok(proposal.customerSavingsCents > 0);
  assert.equal(proposal.eligible, true);
});

test("bundle proposal fails closed for stock, verification, currency, and duplicate problems", () => {
  const base = {
    title: "A",
    categoryId: "x",
    currency: "usd",
    landedCostCents: 1000,
    sellingPriceCents: 1999,
    availability: "in_stock",
    priceVerifiedAt: new Date(),
  };
  const blocked = buildBundleProposal("Blocked Bundle", [
    { ...base, productId: "p1", availability: "unknown" },
    { ...base, productId: "p2", priceVerifiedAt: null },
  ]);
  assert.equal(blocked.eligible, false);
  assert.ok(blocked.reasons.some((reason) => reason.startsWith("not_in_stock:")));
  assert.ok(blocked.reasons.some((reason) => reason.startsWith("price_unverified:")));

  assert.throws(() => buildBundleProposal("Currency Bundle", [
    { ...base, productId: "p1" },
    { ...base, productId: "p2", currency: "eur" },
  ]), /BUNDLE_CURRENCY_MISMATCH/);

  assert.throws(() => buildBundleProposal("Duplicate Bundle", [
    { ...base, productId: "p1" },
    { ...base, productId: "p1" },
  ]), /BUNDLE_DUPLICATE_COMPONENT/);
});

test("catalog growth route remains owner-only, same-origin, bounded, and non-commerce staging", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/app/api/admin/catalog-growth/route.ts", "utf8");
  assert.match(source, /requireAdmin\(\)/);
  assert.match(source, /PRODUCT_ENGINE_OWNER_EMAIL/);
  assert.match(source, /sameOrigin\(req\)/);
  assert.match(source, /readLimitedJson\(req, 600 \* 1024\)/);
  assert.match(source, /quarantined_pending_source_verification/);
  assert.match(source, /commerceEnabled: false/);
  assert.match(source, /resale_authorization/);
  assert.match(source, /supplier_verification/);
});
