import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after, beforeEach } from "node:test";
import { prisma } from "../src/lib/db";
import {
  classifyCandidate,
  ingestCandidate,
  isValidAsin,
  publishCandidate,
  retryCandidate,
  scoreCandidate,
  setEnginePaused,
  validateCandidate,
  classifyOne,
} from "../src/lib/product-engine";
import { buildAmazonProductUrl } from "../src/lib/affiliate/amazon-config";
import { queryProducts } from "../src/lib/products";

const TEST_ASINS = ["B000TEST01", "B000TEST02", "B000TEST03", "B000TEST04", "B000TEST05", "B000TEST06", "B000TEST07", "B000TEST08"];

async function reset() {
  await prisma.productEngineAudit.deleteMany();
  await prisma.productEngineWorkerState.deleteMany();
  await prisma.productCandidate.deleteMany();
  await prisma.productEngineConfig.deleteMany();
  await prisma.clickEvent.deleteMany();
  await prisma.cacheEntry.deleteMany();
  await prisma.product.deleteMany({ where: { asin: { in: TEST_ASINS } } });
  await prisma.category.upsert({ where: { slug: "electronics" }, create: { name: "Electronics", slug: "electronics", icon: "cpu" }, update: {} });
}

beforeEach(reset);
after(async () => { await reset(); await prisma.$disconnect(); });

test("ASIN format validation rejects malformed and accepts valid ASIN", () => {
  assert.equal(isValidAsin("bad"), false);
  assert.equal(isValidAsin("B000TEST01"), true);
  assert.equal(isValidAsin("b000test01"), true);
  assert.equal(isValidAsin("B000-TEST1"), false);
});

test("classification and scoring are deterministic", () => {
  assert.equal(classifyCandidate("USB-C phone charger", ""), "electronics");
  assert.equal(classifyCandidate("Unknown thing", "Custom Category"), "custom-category");
  assert.ok(scoreCandidate({ titleCandidate: "Useful product", brandCandidate: "Brand", categoryCandidate: "electronics", sourceType: "owner_asin", ownerSpecialLink: null }) >= 70);
});

test("valid candidate intake is idempotent under concurrent duplicates", async () => {
  const input = { asin: TEST_ASINS[0], sourceType: "owner_asin", title: "USB-C wall charger", brand: "Example", category: "electronics" } as const;
  const results = await Promise.all([ingestCandidate(input, "test-owner"), ingestCandidate(input, "test-owner")]);
  assert.equal(await prisma.productCandidate.count({ where: { asin: TEST_ASINS[0] } }), 1);
  assert.equal(results.filter((r) => r.duplicate).length, 1);
  assert.equal(results.filter((r) => !r.duplicate).length, 1);
});

test("acceptance threshold rejects low-scoring candidate", async () => {
  await prisma.productEngineConfig.create({ data: { id: "default", acceptanceThreshold: 90 } });
  const { candidate } = await ingestCandidate({ asin: TEST_ASINS[1], sourceType: "owner_asin", title: "USB charger", category: "electronics" }, "test-owner");
  const result = await validateCandidate(candidate.id);
  assert.equal("state" in result ? result.state : "paused", "rejected");
  const stored = await prisma.productCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
  assert.match(stored.rejectionReason ?? "", /below_threshold/);
});

test("only publisher writes accepted candidate into Product catalog", async () => {
  const { candidate } = await ingestCandidate({ asin: TEST_ASINS[2], sourceType: "owner_asin", title: "USB-C charger", brand: "Example", category: "electronics" }, "test-owner");
  await validateCandidate(candidate.id);
  await classifyOne(candidate.id);
  assert.equal(await prisma.product.count({ where: { asin: TEST_ASINS[2] } }), 0);
  await publishCandidate(candidate.id);
  assert.equal(await prisma.product.count({ where: { asin: TEST_ASINS[2] } }), 1);
  const product = await prisma.product.findFirstOrThrow({ where: { asin: TEST_ASINS[2] } });
  assert.equal(product.price, 0);
  assert.equal(product.availability, "unknown");
  assert.equal(product.priceSource, null);
});

test("category quota prevents publication", async () => {
  await prisma.productEngineConfig.create({ data: { id: "default", categoryQuota: 0 } });
  const { candidate } = await ingestCandidate({ asin: TEST_ASINS[3], sourceType: "owner_asin", title: "USB-C charger", brand: "Example", category: "electronics" }, "test-owner");
  await validateCandidate(candidate.id);
  await classifyOne(candidate.id);
  await publishCandidate(candidate.id);
  const stored = await prisma.productCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
  assert.equal(stored.state, "rejected");
  assert.equal(stored.rejectionReason, "category_quota");
  assert.equal(await prisma.product.count({ where: { asin: TEST_ASINS[3] } }), 0);
});

test("master pause stops processing", async () => {
  const { candidate } = await ingestCandidate({ asin: TEST_ASINS[4], sourceType: "owner_asin", title: "USB-C charger", brand: "Example", category: "electronics" }, "test-owner");
  await setEnginePaused(true, "test-owner");
  const result = await validateCandidate(candidate.id);
  assert.deepEqual(result, { paused: true });
  assert.equal((await prisma.productCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).state, "discovered");
});

test("pipeline failures back off into dead-letter and can be retried", async () => {
  const { candidate } = await ingestCandidate({ asin: TEST_ASINS[5], sourceType: "owner_asin", title: "USB-C charger", brand: "Example", category: "electronics" }, "test-owner");
  await prisma.productCandidate.update({ where: { id: candidate.id }, data: { state: "classified", normalizedCategory: null, maxAttempts: 1 } });
  await assert.rejects(() => publishCandidate(candidate.id), /PUBLISH_METADATA_INCOMPLETE/);
  const dead = await prisma.productCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
  assert.equal(dead.state, "dead_letter");
  assert.equal(dead.attemptCount, 1);
  const retried = await retryCandidate(candidate.id, "test-owner");
  assert.equal(retried.state, "discovered");
  assert.equal(retried.attemptCount, 0);
});

test("variation spam protection rejects excessive siblings", async () => {
  await prisma.productEngineConfig.create({ data: { id: "default", maxVariations: 1 } });
  const one = await ingestCandidate({ asin: TEST_ASINS[6], sourceType: "owner_asin", title: "USB-C charger black", brand: "Example", category: "electronics", variationKey: "charger-family" }, "test-owner");
  const two = await ingestCandidate({ asin: TEST_ASINS[7], sourceType: "owner_asin", title: "USB-C charger white", brand: "Example", category: "electronics", variationKey: "charger-family" }, "test-owner");
  await validateCandidate(one.candidate.id);
  await validateCandidate(two.candidate.id);
  const rows = await prisma.productCandidate.findMany({ where: { variationKey: "charger-family" } });
  assert.ok(rows.some((row) => row.rejectionReason?.includes("variation_spam")));
});

test("Amazon affiliate tracking tag is preserved and clicks are user-initiated", async () => {
  assert.match(buildAmazonProductUrl(TEST_ASINS[0]), /amazon\.com\/dp\/B000TEST01\?tag=[^&]+/);
  const engine = await readFile("src/lib/product-engine.ts", "utf8");
  const redirect = await readFile("src/app/go/[productId]/route.ts", "utf8");
  assert.doesNotMatch(engine, /recordClick|\/go\//);
  assert.match(redirect, /recordClick/);
  assert.match(redirect, /export async function GET/);
});

test("owner Product Engine surface enforces server-side admin authorization", async () => {
  const api = await readFile("src/app/api/admin/product-engine/route.ts", "utf8");
  const page = await readFile("src/app/admin/product-engine/page.tsx", "utf8");
  assert.match(api, /requireAdmin/);
  assert.match(api, /return NextResponse\.json\(\{ error: "Unauthorized" \}/);
  assert.match(api, /return NextResponse\.json\(\{ error: "Forbidden" \}/);
  assert.match(page, /user\.role !== "admin"/);
  assert.match(page, /PRODUCT_ENGINE_OWNER_EMAIL/);
});

test("unverified external claims stay suppressed while DealForge presents its own estimate", async () => {
  const card = await readFile("src/components/product-card.tsx", "utf8");
  const detail = await readFile("src/app/product/[slug]/page.tsx", "utf8");
  const products = await readFile("src/lib/products.ts", "utf8");

  for (const source of [card, detail]) {
    assert.doesNotMatch(source, /Check current price on Amazon/i);
    assert.match(source, /DealForge estimate/i);
  }
  assert.match(products, /amazonClaimIntegrity/);
  assert.match(products, /dealForgeEstimatedPrice/);
  assert.match(products, /recommendCommercialPrice/);
  assert.match(products, /priceEstimated/);
});

test("Product Engine mobile UI uses bounded responsive overflow", async () => {
  const page = await readFile("src/app/admin/product-engine/page.tsx", "utf8");
  const controls = await readFile("src/components/product-engine-controls.tsx", "utf8");
  assert.match(page, /min-w-0/);
  assert.match(controls, /overflow-x-auto/);
  assert.match(controls, /max-w-\[/);
});

test("existing non-Amazon catalog path remains functional", async () => {
  const category = await prisma.category.findUniqueOrThrow({ where: { slug: "electronics" } });
  await prisma.product.create({ data: {
    asin: null,
    slug: "test-existing-catalog-product",
    title: "Existing Catalog Product",
    description: "Regression fixture",
    brand: "Fixture",
    categoryId: category.id,
    images: "[]",
    price: 12.5,
    originalPrice: 15,
    affiliateUrl: "https://example.com/product",
    retailer: "example",
  } });
  const result = await queryProducts({ q: "Existing Catalog Product", limit: 10 });
  assert.ok(result.items.some((item) => item.slug === "test-existing-catalog-product"));
  await prisma.product.deleteMany({ where: { slug: "test-existing-catalog-product" } });
});
