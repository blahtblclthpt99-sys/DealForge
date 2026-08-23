import assert from "node:assert/strict";
import test from "node:test";
import {
  estimatedOrderLandedCostCents,
  stateFromFulfillmentMeta,
  transitionFulfillment,
  validateSupplierLineCoverage,
} from "../src/lib/order-fulfillment";

test("fulfillment follows the guarded sourcing progression", () => {
  assert.deepEqual(transitionFulfillment("awaiting_sourcing", "START_SOURCING"), { ok: true, next: "sourcing" });
  assert.deepEqual(transitionFulfillment("sourcing", "MARK_SUPPLIER_ORDERED"), { ok: true, next: "supplier_ordered" });
  assert.deepEqual(transitionFulfillment("supplier_ordered", "MARK_SHIPPED"), { ok: true, next: "shipped" });
  assert.deepEqual(transitionFulfillment("shipped", "MARK_DELIVERED"), { ok: true, next: "delivered" });
});

test("invalid jumps are rejected", () => {
  assert.deepEqual(transitionFulfillment("awaiting_sourcing", "MARK_SHIPPED"), { ok: false, reason: "INVALID_TRANSITION" });
  assert.deepEqual(transitionFulfillment("sourcing", "MARK_DELIVERED"), { ok: false, reason: "INVALID_TRANSITION" });
  assert.deepEqual(transitionFulfillment("delivered", "PLACE_HOLD"), { ok: false, reason: "INVALID_TRANSITION" });
});

test("hold is reversible only through explicit resume", () => {
  assert.deepEqual(transitionFulfillment("sourcing", "PLACE_HOLD"), { ok: true, next: "hold" });
  assert.deepEqual(transitionFulfillment("hold", "RESUME_SOURCING"), { ok: true, next: "sourcing" });
  assert.deepEqual(transitionFulfillment("hold", "MARK_SUPPLIER_ORDERED"), { ok: false, reason: "INVALID_TRANSITION" });
});

test("landed-cost estimate is quantity aware and fail closed", () => {
  assert.equal(estimatedOrderLandedCostCents([
    { quantity: 2, landedCostCents: 500 },
    { quantity: 1, landedCostCents: 225 },
  ]), 1_225);
  assert.equal(estimatedOrderLandedCostCents([{ quantity: 1, landedCostCents: null }]), null);
  assert.equal(estimatedOrderLandedCostCents([{ quantity: 0, landedCostCents: 100 }]), null);
});

test("supplier order coverage requires exactly one valid entry per DealForge order line", () => {
  const lines = [{ id: "a" }, { id: "b" }];
  assert.equal(validateSupplierLineCoverage(lines, [
    { orderItemId: "a", actualCostCents: 500 },
    { orderItemId: "b", actualCostCents: 300 },
  ]), true);
  assert.equal(validateSupplierLineCoverage(lines, [
    { orderItemId: "a", actualCostCents: 500 },
  ]), false);
  assert.equal(validateSupplierLineCoverage(lines, [
    { orderItemId: "a", actualCostCents: 500 },
    { orderItemId: "a", actualCostCents: 300 },
  ]), false);
});

test("only recognized nextState metadata becomes current fulfillment state", () => {
  assert.equal(stateFromFulfillmentMeta({ nextState: "shipped" }), "shipped");
  assert.equal(stateFromFulfillmentMeta({ nextState: "paid" }), null);
  assert.equal(stateFromFulfillmentMeta(null), null);
});
