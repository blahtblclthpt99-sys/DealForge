import assert from "node:assert/strict";
import test from "node:test";
import { checkRecommendationSourceBinding } from "../src/lib/commerce-source-binding";

function specifications(overrides: Record<string, unknown> = {}) {
  return {
    commerceRecommendation: {
      sourceIdentity: {
        retailer: "amazon",
        sourceUrl: "https://www.amazon.com/dp/B012345678",
        asin: "B012345678",
        ...overrides,
      },
    },
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    retailer: "amazon",
    sourceUrl: "https://www.amazon.com/dp/B012345678",
    asin: "B012345678",
    specifications: specifications(),
    ...overrides,
  };
}

test("reviewed supplier identity binds retailer, HTTPS source URL, and ASIN", () => {
  const result = checkRecommendationSourceBinding(input());
  assert.equal(result.bound, true);
  assert.equal(result.reason, "SOURCE_BOUND");
  assert.equal(result.retailer, "amazon");
  assert.equal(result.asin, "B012345678");
});

test("retailer, URL, or ASIN drift invalidates the reviewed source", () => {
  assert.equal(checkRecommendationSourceBinding(input({ retailer: "walmart" })).reason, "SOURCE_IDENTITY_DRIFT");
  assert.equal(checkRecommendationSourceBinding(input({ sourceUrl: "https://www.amazon.com/dp/B087654321" })).reason, "SOURCE_IDENTITY_DRIFT");
  assert.equal(checkRecommendationSourceBinding(input({ asin: "B087654321" })).reason, "SOURCE_IDENTITY_DRIFT");
});

test("missing recommendation source identity fails closed", () => {
  const result = checkRecommendationSourceBinding(input({ specifications: { commerceRecommendation: {} } }));
  assert.equal(result.bound, false);
  assert.equal(result.reason, "SOURCE_IDENTITY_MISSING");
});

test("unsafe or malformed source URLs fail closed", () => {
  assert.equal(checkRecommendationSourceBinding(input({ sourceUrl: "http://www.amazon.com/dp/B012345678" })).reason, "SOURCE_IDENTITY_INVALID");
  assert.equal(checkRecommendationSourceBinding(input({ sourceUrl: "https://localhost/item" })).reason, "SOURCE_IDENTITY_INVALID");
});

test("Amazon source binding requires a valid ten-character ASIN", () => {
  const result = checkRecommendationSourceBinding(input({ asin: "BAD" }));
  assert.equal(result.bound, false);
  assert.equal(result.reason, "SOURCE_IDENTITY_INVALID");
});

test("JSON-encoded database specifications are supported", () => {
  const result = checkRecommendationSourceBinding(input({ specifications: JSON.stringify(specifications()) }));
  assert.equal(result.bound, true);
});
