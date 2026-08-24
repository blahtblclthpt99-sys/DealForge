import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

async function runtimeSourceFiles(root = "src"): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await runtimeSourceFiles(path));
    else if (/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

test("direct purchase button uses DealForge checkout while affiliate mode uses outbound route", async () => {
  const source = await readFile("src/components/buy-button.tsx", "utf8");

  assert.match(source, /purchaseMode !== "direct"/);
  assert.match(source, /href=\{`\/go\/\$\{productId\}`\}/);
  assert.match(source, /fetch\("\/api\/checkout"/);
  assert.match(source, /items: \[\{ productId, quantity: 1 \}\]/);
  assert.match(source, /window\.location\.assign\(payload\.checkoutUrl\)/);
  assert.match(source, /Buy from DealForge/);
});

test("product page separates verified direct sales from DealForge estimates", async () => {
  const page = await readFile("src/app/product/[slug]/page.tsx", "utf8");
  const card = await readFile("src/components/product-card.tsx", "utf8");

  assert.match(page, /product\.purchaseMode === "direct" && product\.commerceReady/);
  assert.match(page, /Sold by DealForge/);
  assert.match(page, /DealForge estimated price/);
  assert.match(page, /Estimated DealForge selling price based on DealForge reserve, profit, and margin logic/);
  assert.match(page, /affiliateLabel="View source listing"/);
  assert.match(page, /Your payment is processed through DealForge secure checkout/);
  assert.match(card, /DealForge estimate/);
});

test("runtime UI never tells customers to check Amazon for a price", async () => {
  for (const path of await runtimeSourceFiles()) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, /Check current price on Amazon/i, path);
  }
});

test("public product DTO calculates estimates but checkout authority remains separate", async () => {
  const source = await readFile("src/lib/products.ts", "utf8");
  const checkout = await readFile("src/app/api/checkout/route.ts", "utf8");

  assert.match(source, /PRIVATE_SPECIFICATION_KEYS/);
  assert.match(source, /"supplierOfferV1"/);
  assert.match(source, /"commerceV1"/);
  assert.match(source, /if \(PRIVATE_SPECIFICATION_KEYS\.has\(key\)\) continue/);
  assert.match(source, /recommendCommercialPrice/);
  assert.match(source, /priceEstimated/);
  assert.match(source, /priceSource: direct \? "dealforge" : priceEstimated \? "dealforge_estimate"/);
  assert.match(source, /purchaseMode: direct \? "direct" : "affiliate"/);
  assert.match(source, /if \(process\.env\.COMMERCE_ENABLED !== "true"\) return \{ allowed: false \}/);
  assert.match(checkout, /sellingPriceCents/);
  assert.doesNotMatch(checkout, /dealForgeEstimatedPrice/);
});
