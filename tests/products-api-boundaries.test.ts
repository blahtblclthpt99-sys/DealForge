import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parsePublicProductQuery } from "../src/lib/product-query-input";

test("public product query parser applies safe defaults and accepted filters", () => {
  const parsed = parsePublicProductQuery(
    new URLSearchParams("q=phone&minPrice=10.50&maxPrice=250&page=2&limit=48&sort=popularity&featured=1"),
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.query.q, "phone");
  assert.equal(parsed.query.minPrice, 10.5);
  assert.equal(parsed.query.maxPrice, 250);
  assert.equal(parsed.query.page, 2);
  assert.equal(parsed.query.limit, 48);
  assert.equal(parsed.query.sort, "popularity");
  assert.equal(parsed.query.featured, true);
});

test("public product query parser accepts the UI best-match sort mode", () => {
  const parsed = parsePublicProductQuery(new URLSearchParams("sort=rank"));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.query.sort, "rank");
});

test("public product query parser rejects NaN, infinities, invalid ranges, flags, and oversized pages", () => {
  for (const query of [
    "minPrice=NaN",
    "maxPrice=Infinity",
    "minPrice=20&maxPrice=10",
    "minRating=6",
    "minDiscount=101",
    "page=0",
    "page=10001",
    "limit=49",
    "featured=true",
    "sort=random",
  ]) {
    assert.equal(parsePublicProductQuery(new URLSearchParams(query)).ok, false, query);
  }
});

test("public product query parser bounds free-text inputs", () => {
  assert.equal(parsePublicProductQuery(new URLSearchParams({ q: "x".repeat(201) })).ok, false);
  assert.equal(parsePublicProductQuery(new URLSearchParams({ brand: "x".repeat(161) })).ok, false);
});

test("products API uses the validated parser instead of direct Number conversions", async () => {
  const source = await readFile("src/app/api/products/route.ts", "utf8");
  assert.match(source, /parsePublicProductQuery/);
  assert.match(source, /INVALID_PRODUCT_QUERY/);
  assert.doesNotMatch(source, /Number\(/);
  assert.match(source, /Cache-Control/);
});

test("server-rendered search reuses the same validated parser", async () => {
  const source = await readFile("src/app/search/page.tsx", "utf8");
  assert.match(source, /parsePublicProductQuery/);
  assert.doesNotMatch(source, /Number\(/);
  assert.match(source, /Search filters need attention/);
});
