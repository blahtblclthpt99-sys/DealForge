import assert from "node:assert/strict";
import test from "node:test";
import { evaluateLiveStripeTaxReadiness } from "../src/lib/stripe-live-tax-readiness";

const readySettings = {
  status: "active",
  livemode: true,
  defaults: { tax_behavior: "exclusive", tax_code: "txcd_99999999" },
  head_office: {
    address: {
      line1: "1 Main St",
      city: "Oklahoma City",
      state: "OK",
      postal_code: "73102",
      country: "US",
    },
  },
};

test("live tax readiness passes only with an active live registration", () => {
  const result = evaluateLiveStripeTaxReadiness(readySettings, [
    { id: "taxreg_1", livemode: true, status: "active", country: "US" },
  ]);
  assert.equal(result.ready, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.activeRegistrationCount, 1);
});

test("zero live registrations fails closed", () => {
  const result = evaluateLiveStripeTaxReadiness(readySettings, []);
  assert.equal(result.ready, false);
  assert.ok(result.reasons.includes("STRIPE_LIVE_TAX_REGISTRATION_MISSING"));
});

test("sandbox registrations never satisfy live readiness", () => {
  const result = evaluateLiveStripeTaxReadiness(readySettings, [
    { id: "taxreg_test", livemode: false, status: "active", country: "US" },
  ]);
  assert.equal(result.ready, false);
  assert.equal(result.activeRegistrationCount, 0);
});

test("incomplete live tax settings fail closed", () => {
  const result = evaluateLiveStripeTaxReadiness(
    { status: "active", livemode: true, defaults: { tax_behavior: "exclusive" } },
    [{ id: "taxreg_1", livemode: true, status: "active", country: "US" }],
  );
  assert.equal(result.ready, false);
  assert.ok(result.reasons.includes("STRIPE_TAX_HEAD_OFFICE_INCOMPLETE"));
  assert.ok(result.reasons.includes("STRIPE_DEFAULT_TAX_CODE_MISSING"));
});
