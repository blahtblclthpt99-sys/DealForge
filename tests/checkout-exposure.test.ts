import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CHECKOUT_EXPOSURE_LIMITS,
  checkCheckoutExposure,
} from "../src/lib/checkout-exposure";

const line = (quantity: number, unitPriceCents = 10_000, landedCostCents = 6_000) => ({
  quantity,
  unitPriceCents,
  landedCostCents,
});

test("pilot exposure limits accept a bounded checkout", () => {
  const result = checkCheckoutExposure([line(2), line(2, 12_000, 7_000)]);
  assert.equal(result.eligible, true);
  assert.equal(result.reason, "OK");
  assert.equal(result.unitCount, 4);
});

test("pilot exposure limits fail closed at every transaction boundary", () => {
  assert.equal(checkCheckoutExposure([line(6)]).reason, "LINE_QUANTITY_LIMIT_EXCEEDED");
  assert.equal(checkCheckoutExposure([line(5), line(4)]).reason, "UNIT_COUNT_LIMIT_EXCEEDED");
  assert.equal(
    checkCheckoutExposure([line(1, CHECKOUT_EXPOSURE_LIMITS.maxCustomerTotalCents + 1, 100)]).reason,
    "CUSTOMER_TOTAL_LIMIT_EXCEEDED",
  );
  assert.equal(
    checkCheckoutExposure([line(1, 120_000, CHECKOUT_EXPOSURE_LIMITS.maxSupplierExposureCents + 1)]).reason,
    "SUPPLIER_EXPOSURE_LIMIT_EXCEEDED",
  );
  assert.equal(checkCheckoutExposure([line(1, 100, null as unknown as number)]).reason, "INVALID_INPUT");
});

test("checkout runs the exposure gate before creating an Order or Stripe session", async () => {
  const route = await readFile("src/app/api/checkout/route.ts", "utf8");
  assert.match(route, /checkCheckoutExposure/);
  assert.match(route, /CHECKOUT_LIMIT_EXCEEDED/);

  const exposure = route.indexOf('stage = "exposure_gate"');
  const order = route.indexOf('stage = "order_create"');
  const stripe = route.indexOf('stage = "stripe_session"');
  assert.ok(exposure >= 0, "missing checkout exposure gate");
  assert.ok(order > exposure, "Order creation must occur after exposure validation");
  assert.ok(stripe > exposure, "Stripe session creation must occur after exposure validation");
});
