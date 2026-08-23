import assert from "node:assert/strict";
import test from "node:test";
import { CHECKOUT_EXPOSURE_LIMITS, checkCheckoutExposure } from "../src/lib/checkout-exposure";

test("allows a normal pilot checkout and reports internal exposure totals", () => {
  const result = checkCheckoutExposure([
    { quantity: 2, unitPriceCents: 12_500, landedCostCents: 8_000 },
    { quantity: 1, unitPriceCents: 5_000, landedCostCents: 3_000 },
  ]);
  assert.equal(result.eligible, true);
  assert.equal(result.reason, "OK");
  assert.equal(result.unitCount, 3);
  assert.equal(result.customerTotalCents, 30_000);
  assert.equal(result.supplierExposureCents, 19_000);
});

test("enforces the per-line quantity ceiling", () => {
  const result = checkCheckoutExposure([
    { quantity: CHECKOUT_EXPOSURE_LIMITS.maxLineQuantity + 1, unitPriceCents: 1_000, landedCostCents: 500 },
  ]);
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "LINE_QUANTITY_LIMIT_EXCEEDED");
});

test("enforces the aggregate unit ceiling across lines", () => {
  const result = checkCheckoutExposure([
    { quantity: 5, unitPriceCents: 1_000, landedCostCents: 500 },
    { quantity: 4, unitPriceCents: 1_000, landedCostCents: 500 },
  ]);
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "UNIT_COUNT_LIMIT_EXCEEDED");
});

test("enforces customer charge exposure before Stripe session creation", () => {
  const result = checkCheckoutExposure([
    { quantity: 1, unitPriceCents: CHECKOUT_EXPOSURE_LIMITS.maxCustomerTotalCents + 1, landedCostCents: 10_000 },
  ]);
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "CUSTOMER_TOTAL_LIMIT_EXCEEDED");
});

test("enforces supplier sourcing exposure independently of customer total", () => {
  const result = checkCheckoutExposure([
    { quantity: 1, unitPriceCents: 120_000, landedCostCents: CHECKOUT_EXPOSURE_LIMITS.maxSupplierExposureCents + 1 },
  ]);
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "SUPPLIER_EXPOSURE_LIMIT_EXCEEDED");
});

test("allows exact pilot boundaries", () => {
  const result = checkCheckoutExposure([
    {
      quantity: 1,
      unitPriceCents: CHECKOUT_EXPOSURE_LIMITS.maxCustomerTotalCents,
      landedCostCents: CHECKOUT_EXPOSURE_LIMITS.maxSupplierExposureCents,
    },
  ]);
  assert.equal(result.eligible, true);
});

test("fails closed on malformed money or quantity values", () => {
  assert.equal(checkCheckoutExposure([{ quantity: 0, unitPriceCents: 1_000, landedCostCents: 500 }]).reason, "INVALID_INPUT");
  assert.equal(checkCheckoutExposure([{ quantity: 1, unitPriceCents: Number.MAX_SAFE_INTEGER + 1, landedCostCents: 500 }]).reason, "INVALID_INPUT");
  assert.equal(checkCheckoutExposure([{ quantity: 1, unitPriceCents: 1_000, landedCostCents: null }]).reason, "INVALID_INPUT");
});
