import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("primary storefront grids remain two-column and responsive on narrow mobile layouts", async () => {
  const feed = await readFile("src/components/infinite-feed.tsx", "utf8");
  const search = await readFile("src/components/search-client.tsx", "utf8");

  assert.match(feed, /grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4/);
  assert.match(search, /mt-6 grid grid-cols-2 gap-3 md:grid-cols-3/);
});

test("product cards cannot force horizontal overflow in narrow two-column grids", async () => {
  const card = await readFile("src/components/product-card.tsx", "utf8");
  const quickAdd = await readFile("src/components/quick-add-button.tsx", "utf8");

  assert.match(card, /group flex min-w-0 flex-col overflow-hidden/);
  assert.match(card, /flex min-w-0 flex-1 flex-col gap-2 p-3 sm:p-4/);
  assert.match(card, /min-w-0 break-words text-xs/);
  assert.match(card, /line-clamp-2 min-w-0 break-words/);
  assert.match(card, /flex min-w-0 flex-wrap items-end justify-between/);
  assert.match(card, /flex shrink-0 items-center gap-1/);
  assert.match(card, /flex min-w-0 flex-wrap items-center justify-between/);
  assert.match(card, /min-w-\[7rem\] flex-1/);
  assert.match(quickAdd, /inline-flex shrink-0 items-center gap-1\.5 whitespace-nowrap/);
});

test("mobile rendering preserves truthful inventory and direct-commerce actions", async () => {
  const card = await readFile("src/components/product-card.tsx", "utf8");
  const quickAdd = await readFile("src/components/quick-add-button.tsx", "utf8");

  assert.match(card, /product\.purchaseMode === "direct" && product\.commerceReady/);
  assert.match(card, /direct && product\.availabilityVerified && product\.availability === "in_stock"/);
  assert.match(card, /In stock · Sold by DealForge/);
  assert.match(card, /Check price &amp; availability at source/);
  assert.match(card, /Final price calculated in cart/);
  assert.match(card, /<QuickAddButton productId=\{product\.id\} \/>/);
  assert.match(quickAdd, /fetch\("\/api\/cart\/quote"/);
  assert.doesNotMatch(quickAdd, /\/api\/checkout/);
});
