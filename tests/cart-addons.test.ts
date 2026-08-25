import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("cart offers cheap add-ons before the rendered checkout action", async () => {
  const source = await readFile("src/components/cart-client.tsx", "utf8");
  // Use the quoted rendered labels rather than a generic word search; comments
  // and function names may legitimately mention checkout earlier in the file.
  const addonButton = source.lastIndexOf('"Find cheap add-ons"');
  const checkoutButton = source.lastIndexOf('"Checkout"');

  assert.ok(addonButton >= 0, "cart must expose a cheap add-on search action");
  assert.ok(checkoutButton >= 0, "cart must expose checkout");
  assert.ok(addonButton < checkoutButton, "bundle search must appear before checkout");
  assert.match(source, /fetch\("\/api\/cart\/addons"/);
  assert.match(source, /addCartItem\(productId, 1\)/);
});

test("bundle suggestions are fail-closed and commercially validated", async () => {
  const source = await readFile("src/app/api/cart/addons/route.ts", "utf8");

  assert.match(source, /process\.env\.COMMERCE_ENABLED !== "true"/);
  assert.match(source, /availability: "in_stock"/);
  assert.match(source, /evaluateCommerceGate/);
  assert.match(source, /checkPersistedOfferBinding/);
  assert.match(source, /calculateCustomerFriendlyPrice/);
  assert.match(source, /HARD_ADDON_PRICE_CAP_CENTS/);
  assert.match(source, /ADDON_RATIO_BPS/);
  assert.match(source, /id: \{ notIn: cartIds \}/);
});

test("customer savings fund policy keeps phase A measure-only before real checkout release", async () => {
  const strategy = await readFile("docs/customer-savings-fund-strategy.md", "utf8");
  const policy = await readFile("src/lib/customer-savings-fund.ts", "utf8");
  const migration = await readFile(
    "prisma/migrations/20260825120000_customer_savings_fund_phase_a/migration.sql",
    "utf8",
  );

  assert.match(strategy, /realized contribution profit/i);
  assert.match(strategy, /immutable Savings Fund ledger/i);
  assert.match(strategy, /Do not connect this fund directly to production checkout yet/i);
  assert.match(strategy, /financial reconciliation is unhealthy/i);
  assert.match(policy, /SAVINGS_FUND_MODE = "dry_run"/);
  assert.match(policy, /appliesToCheckout: false/);
  assert.match(migration, /SavingsFundEntry/);
  assert.doesNotMatch(migration, /'release'/);
});
