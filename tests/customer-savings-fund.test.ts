import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  calculateSavingsFundAccrual,
  calculateSavingsFundDryRun,
  currentSavingsFundPolicy,
  SAVINGS_FUND_MODE,
  SAVINGS_FUND_POLICY_VERSION,
} from "../src/lib/customer-savings-fund";

test("phase A accrues only a controlled share of certified positive contribution", () => {
  assert.equal(calculateSavingsFundAccrual(10_00, 1_000), 100);
  assert.equal(calculateSavingsFundAccrual(0, 1_000), 0);
  assert.equal(calculateSavingsFundAccrual(-500, 1_000), 0);
});

test("dry-run savings are capped by fund balance, five percent of cart, and 25 percent of order contribution", () => {
  const decision = calculateSavingsFundDryRun({
    availableFundCents: 50_00,
    cartSubtotalCents: 100_00,
    preSubsidyContributionCents: 20_00,
  });

  assert.equal(decision.eligible, true);
  assert.equal(decision.proposedSavingsCents, 500);
  assert.equal(decision.hypotheticalCustomerTotalCents, 95_00);
  assert.equal(decision.postSubsidyContributionCents, 15_00);
  assert.equal(decision.appliesToCheckout, false);
});

test("dry-run does not release tiny balances or create a loss", () => {
  const tiny = calculateSavingsFundDryRun({
    availableFundCents: 49,
    cartSubtotalCents: 100_00,
    preSubsidyContributionCents: 20_00,
  });
  assert.equal(tiny.proposedSavingsCents, 0);
  assert.equal(tiny.reason, "BELOW_MINIMUM_RELEASE");

  const noProfit = calculateSavingsFundDryRun({
    availableFundCents: 10_00,
    cartSubtotalCents: 100_00,
    preSubsidyContributionCents: 0,
  });
  assert.equal(noProfit.proposedSavingsCents, 0);
  assert.equal(noProfit.reason, "NO_POSITIVE_ORDER_CONTRIBUTION");
});

test("phase A policy is permanently measure-only until a later explicit phase change", () => {
  const policy = currentSavingsFundPolicy();
  assert.equal(policy.version, SAVINGS_FUND_POLICY_VERSION);
  assert.equal(policy.mode, SAVINGS_FUND_MODE);
  assert.equal(policy.appliesToCheckout, false);
  assert.equal(policy.maxCartSavingsBps, 500);
  assert.equal(policy.maxOrderProfitReductionBps, 2_500);
});

test("cart quote exposes a shadow preview but checkout never consumes Savings Fund discounts", async () => {
  const quote = await readFile("src/app/api/cart/quote/route.ts", "utf8");
  const checkout = await readFile("src/app/api/checkout/route.ts", "utf8");

  assert.match(quote, /savingsFundDryRun/);
  assert.match(quote, /chargedSubtotalCents: subtotalCents/);
  assert.match(quote, /appliesToCheckout: false/);
  assert.doesNotMatch(checkout, /customer-savings-fund/);
  assert.doesNotMatch(checkout, /SavingsFundEntry/);
  assert.doesNotMatch(checkout, /proposedSavingsCents/);
});

test("Savings Fund migration makes the phase-A ledger append-only", async () => {
  const migration = await readFile(
    "prisma/migrations/20260825120000_customer_savings_fund_phase_a/migration.sql",
    "utf8",
  );
  assert.match(migration, /SavingsFundEntry/);
  assert.match(migration, /BEFORE UPDATE ON "SavingsFundEntry"/);
  assert.match(migration, /BEFORE DELETE ON "SavingsFundEntry"/);
  assert.match(migration, /SavingsFundEntry_phase_a_dry_run/);
  assert.match(migration, /CHECK \("dryRun" = TRUE\)/);
});
