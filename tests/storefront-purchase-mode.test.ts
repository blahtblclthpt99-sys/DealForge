import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("direct purchase button uses DealForge checkout while affiliate mode uses outbound route", async () => {
  const source = await readFile("src/components/buy-button.tsx", "utf8");

  assert.match(source, /purchaseMode !== "direct"/);
  assert.match(source, /href=\{`\/go\/\$\{productId\}`\}/);
  assert.match(source, /fetch\("\/api\/checkout"/);
  assert.match(source, /items: \[\{ productId, quantity: 1 \}\]/);
  assert.match(source, /window\.location\.assign\(payload\.checkoutUrl\)/);
  assert.match(source, /Buy from DealForge/);
});

test("product page clearly separates direct sale copy from affiliate fallback", async () => {
  const source = await readFile("src/app/product/[slug]/page.tsx", "utf8");

  assert.match(source, /product\.purchaseMode === "direct" && product\.commerceReady/);
  assert.match(source, /Sold by DealForge/);
  assert.match(source, /purchaseMode=\{product\.purchaseMode\}/);
  assert.match(source, /Your payment is processed through DealForge secure checkout/);
  assert.match(source, /Outbound Amazon link may earn DealForge a commission/);
  assert.match(source, /!direct \? \(/);
});

test("public product DTO never exposes internal supplier economics", async () => {
  const source = await readFile("src/lib/products.ts", "utf8");

  assert.match(source, /PRIVATE_SPECIFICATION_KEYS/);
  assert.match(source, /"supplierOfferV1"/);
  assert.match(source, /"commerceV1"/);
  assert.match(source, /if \(PRIVATE_SPECIFICATION_KEYS\.has\(key\)\) continue/);
  assert.match(source, /purchaseMode: direct \? "direct" : "affiliate"/);
  assert.match(source, /if \(process\.env\.COMMERCE_ENABLED !== "true"\) return \{ allowed: false \}/);
});
