import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public home page does not expose deployment configuration or raw database failures", async () => {
  const source = await readFile("src/app/page.tsx", "utf8");
  assert.doesNotMatch(source, /DATABASE_URL/);
  assert.doesNotMatch(source, /AUTH_SECRET/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_APP_URL/);
  assert.doesNotMatch(source, /Unknown database error/);
  assert.match(source, /Catalog temporarily unavailable/);
  assert.match(source, /console\.error\("Failed to load DealForge storefront catalog"/);
});

test("home page avoids broad commerce claims while the catalog commerce lock remains active", async () => {
  const source = await readFile("src/app/page.tsx", "utf8");
  assert.doesNotMatch(source, /Verified commerce/);
  assert.doesNotMatch(source, /purchase securely through DealForge/);
  assert.doesNotMatch(source, /Flash Deals/);
  assert.match(source, /Direct checkout remains gated by server-side commerce checks/);
  assert.match(source, /action="\/search"/);
});

test("wishlist optimism rolls back when the server rejects the mutation", async () => {
  const source = await readFile("src/components/product-card.tsx", "utf8");
  assert.match(source, /if \(!response\.ok\) throw new Error/);
  assert.match(source, /setLiked\(previous\)/);
  assert.match(source, /savingWishlist/);
  assert.match(source, /aria-pressed=\{liked\}/);
});
