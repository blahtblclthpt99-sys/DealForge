import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("storefront keeps direct checkout path intact", async () => {
  const productPage = await readFile("src/app/product/[slug]/page.tsx", "utf8");
  const buyButton = await readFile("src/components/buy-button.tsx", "utf8");
  assert.match(productPage, /purchaseMode=\{product\.purchaseMode\}/);
  assert.match(productPage, /commerceReady/);
  assert.match(productPage, /Your payment is processed through DealForge secure checkout/);
  assert.match(buyButton, /\/api\/checkout/);
  assert.match(buyButton, /Buy from DealForge/);
});

test("Amazon discovery preserves the approved current-price fallback", async () => {
  const productPage = await readFile("src/app/product/[slug]/page.tsx", "utf8");
  const card = await readFile("src/components/product-card.tsx", "utf8");
  assert.match(productPage, /Check current price on Amazon/);
  assert.match(card, /Check current price on Amazon/);
  assert.match(productPage, /Check current availability/);
});

test("storefront removes personal header copy and keeps mobile search", async () => {
  const header = await readFile("src/components/header.tsx", "utf8");
  assert.doesNotMatch(header, /oooooo youre so sexy mamma/i);
  assert.doesNotMatch(header, /lisasalas85@icloud\.com/i);
  assert.match(header, /aria-label="Search products"/);
});

test("search uses confidence-first controls rather than stale commerce claims", async () => {
  const search = await readFile("src/components/search-client-v2.tsx", "utf8");
  const page = await readFile("src/app/search/page.tsx", "utf8");
  assert.match(page, /SearchClientV2/);
  assert.doesNotMatch(search, /Biggest savings/);
  assert.doesNotMatch(search, /Min rating/);
  assert.doesNotMatch(search, /Min discount/);
  assert.match(search, /current verified availability signal/i);
});

test("home is search-first and does not expose certification inventory", async () => {
  const home = await readFile("src/app/page.tsx", "utf8");
  const feed = await readFile("src/components/infinite-feed.tsx", "utf8");
  assert.match(home, /Search DealForge/);
  assert.match(home, /publicCatalogItems/);
  assert.match(feed, /publicCatalogItems/);
});
