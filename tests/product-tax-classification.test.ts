import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  bindTaxClassificationToSourceSnapshot,
  evaluateProductTaxClassification,
  readProductTaxClassification,
} from "../src/lib/product-tax-classification";

const now = Date.parse("2026-08-26T01:40:00.000Z");

function specifications(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    taxV1: {
      stripeTaxCode: "txcd_99999999",
      classification: "general_tangible_goods",
      verifiedAt: "2026-08-25T12:00:00.000Z",
      verificationSource: "stripe-tax-code-review",
      maxAgeDays: 365,
      ...overrides,
    },
  });
}

test("accepts a current explicit Stripe product tax classification", () => {
  const decision = evaluateProductTaxClassification(specifications(), now);
  assert.equal(decision.allowed, true);
  assert.equal(decision.classification?.stripeTaxCode, "txcd_99999999");
});

test("fails closed when taxV1 is missing or malformed", () => {
  assert.deepEqual(
    evaluateProductTaxClassification("{}", now).reasons,
    ["tax_classification_missing_or_invalid"],
  );
  assert.equal(
    evaluateProductTaxClassification(specifications({ stripeTaxCode: "not-a-tax-code" }), now).allowed,
    false,
  );
  assert.equal(readProductTaxClassification("not-json"), null);
});

test("rejects stale and future-dated classification evidence", () => {
  const stale = evaluateProductTaxClassification(
    specifications({ verifiedAt: "2025-08-01T00:00:00.000Z", maxAgeDays: 30 }),
    now,
  );
  assert.equal(stale.allowed, false);
  assert.deepEqual(stale.reasons, ["tax_classification_stale"]);

  const future = evaluateProductTaxClassification(
    specifications({ verifiedAt: "2026-08-27T00:00:00.000Z" }),
    now,
  );
  assert.equal(future.allowed, false);
  assert.deepEqual(future.reasons, ["tax_classification_verification_invalid"]);
});

test("binds tax evidence into the immutable order source snapshot", () => {
  const classification = readProductTaxClassification(specifications());
  assert.ok(classification);
  const snapshot = bindTaxClassificationToSourceSnapshot(
    JSON.stringify({ supplierId: "sup_1", offerId: "offer_1" }),
    classification,
  );
  const parsed = JSON.parse(snapshot);
  assert.equal(parsed.supplierId, "sup_1");
  assert.equal(parsed.taxClassificationV1.stripeTaxCode, "txcd_99999999");
});

test("checkout uses verified product tax codes and revalidates their snapshot before Stripe", async () => {
  const checkout = await readFile("src/app/api/checkout/route.ts", "utf8");
  const stripe = await readFile("src/lib/stripe-commerce.ts", "utf8");

  assert.match(checkout, /evaluateProductTaxClassification\(product\.specifications\)/);
  assert.match(checkout, /PRODUCT_TAX_CLASSIFICATION_FAILED/);
  assert.match(checkout, /bindTaxClassificationToSourceSnapshot/);
  assert.match(checkout, /taxCode: taxCodeByProductId\.get\(item\.productId\)/);
  assert.match(stripe, /taxCode\?: string \| null/);
  assert.match(stripe, /line\.taxCode/);
  assert.match(stripe, /assertStripeProductTaxCode/);
});
