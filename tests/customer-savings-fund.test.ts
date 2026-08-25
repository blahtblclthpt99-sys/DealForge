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
  assert.equal(calculateSavingsFundAccrual(1_000, 1_000), 100);
  assert.equal(calculateSavingsFundAccrual(0, 1_000), 0);
  assert.equal(calculateSavingsFundAccrual(-500, 1_000), 0);
});

test("dry-run savings are capped by fund balance, five percent of cart, and 25 percent of order contribution", () => {
  const decision = calculateSavingsFundDryRun({
    availableFundCents: 5_000,
    cartSubtotalCents: 10_000,
    preSubsidyContributionCents: 2_000,
  });

  assert.equal(decision.eligible, true);
  assert.equal(decision.proposedSavingsCents, 500);
  assert.equal(decision.hypotheticalCustomerTotalCents, 9_500);
  assert.equal(decision.postSubsidyContributionCents, 1_500);
  assert.equal(decision.appliesToCheckout, false);
});

test("dry-run does not release tiny balances or create a loss", () => {
  const tiny = calculateSavingsFundDryRun({
    availableFundCents: 49,
    cartSubtotalCents: 10_000,
    preSubsidyContributionCents: 2_000,
  });
  assert.equal(tiny.proposedSavingsCents, 0);
  assert.equal(tiny.reason, "BELOW_MINIMUM_RELEASE");

  const noProfit = calculateSavingsFundDryRun({
    availableFundCents: 1_000,
    cartSubtotalCents: 10_000,
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

test("public cart and checkout do not expose or consume Savings Fund economics", async () => {
  const quote = await readFile("src/app/api/cart/quote/route.ts", "utf8");
  const checkout = await readFile("src/app/api/checkout/route.ts", "utf8");

  for (const source of [quote, checkout]) {
    assert.doesNotMatch(source, /customer-savings-fund/);
    assert.doesNotMatch(source, /SavingsFundEntry/);
    assert.doesNotMatch(source, /proposedSavingsCents/);
    assert.doesNotMatch(source, /availableFundCents/);
  }
});

test("private admin endpoint owns dry-run simulation and never enables releases", async () => {
  const route = await readFile("src/app/api/admin/finance/savings-fund/route.ts", "utf8");
  assert.match(route, /requireAdmin/);
  assert.match(route, /action: z\.literal\("simulate"\)/);
  assert.match(route, /calculateSavingsFundDryRun/);
  assert.match(route, /appliesToCheckout: false/);
  assert.match(route, /automaticReleaseEnabled: false/);
});

test("ledger reconciliation uses monotonic per-order revision keys", async () => {
  const ledger = await readFile("src/lib/savings-fund-ledger.ts", "utf8");
  assert.match(ledger, /COUNT\(\*\) AS "entryCount"/);
  assert.match(ledger, /const nextRevision = before\.entryCount \+ 1/);
  assert.match(ledger, /revision:\$\{nextRevision\}/);
  assert.match(ledger, /ON CONFLICT\("entryKey"\) DO NOTHING/);
  assert.match(ledger, /SAVINGS_FUND_RECONCILIATION_CONCURRENT_CHANGE/);
});

test("Savings Fund migration makes the phase-A ledger append-only and forbids releases", async () => {
  const migration = await readFile(
    "prisma/migrations/20260825120000_customer_savings_fund_phase_a/migration.sql",
    "utf8",
  );
  assert.match(migration, /SavingsFundEntry/);
  assert.match(migration, /BEFORE UPDATE ON "SavingsFundEntry"/);
  assert.match(migration, /BEFORE DELETE ON "SavingsFundEntry"/);
  assert.match(migration, /SavingsFundEntry_phase_a_type/);
  assert.match(migration, /'accrual', 'reversal', 'adjustment'/);
  assert.doesNotMatch(migration, /'release'/);
  assert.doesNotMatch(migration, /'allocation'/);
  assert.match(migration, /SavingsFundEntry_phase_a_dry_run/);
  assert.match(migration, /CHECK \("dryRun" = TRUE\)/);
});
