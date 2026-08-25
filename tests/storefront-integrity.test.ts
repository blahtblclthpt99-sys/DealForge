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

test("product detail wishlist preserves the real return path across login", async () => {
  const source = await readFile("src/components/wishlist-button.tsx", "utf8");
  assert.doesNotMatch(source, /next=\/product\//);
  assert.match(source, /window\.location\.pathname/);
  assert.match(source, /window\.location\.search/);
  assert.match(source, /encodeURIComponent\(current\)/);
  assert.match(source, /setLiked\(previous\)/);
});

test("login page contains no packaged credentials and constrains next redirects to the same origin", async () => {
  const source = await readFile("src/app/login/page.tsx", "utf8");
  assert.doesNotMatch(source, /DemoUser123!/);
  assert.doesNotMatch(source, /demo@dealforge\.com/);
  assert.doesNotMatch(source, /admin@dealforge\.com/);
  assert.match(source, /safeLoginRedirect/);
  assert.match(source, /target\.origin !== origin/);
  assert.match(source, /value\.startsWith\("\/\/"\)/);
  assert.match(source, /safeLoginRedirect\(searchParams\.get\("next"\), window\.location\.origin\)/);
});
