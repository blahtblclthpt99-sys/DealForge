import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PROCUREMENT_BLOCKED_REASON,
  PROCUREMENT_BLOCKED_STATUS,
  PROCUREMENT_EXECUTION_MODE,
  PROCUREMENT_READY_STATUS,
  deriveProcurementIntentSeed,
  parseProcurementSupplierSnapshot,
} from "../src/lib/procurement-intents";

function validSnapshot(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    persistedSupplierId: "supplier-a",
    persistedOfferId: "offer-a",
    persistedOfferKey: "offer-a:key",
    supplierName: "Verified Supplier",
    sourceClass: "authorized_dropshipper",
    sourceUrl: "https://supplier.example/item",
    sourceVerifiedAt: "2026-08-25T00:00:00.000Z",
    priceVerifiedAt: "2026-08-25T01:00:00.000Z",
    inventoryConfidenceBps: 9000,
    availability: "in_stock",
    currency: "usd",
    costBreakdown: {
      itemCostCents: 2000,
      shippingCents: 200,
      taxCents: 100,
      supplierFeeCents: 50,
      handlingCents: 25,
      landedCostCents: 2375,
    },
    ...overrides,
  });
}

test("valid paid-order source data produces a manual review intent with locked costs", () => {
  const seed = deriveProcurementIntentSeed(
    {
      id: "item-a",
      orderId: "order-a",
      quantity: 2,
      landedCostCents: 2375,
      supplierSnapshot: validSnapshot(),
    },
    "USD",
  );

  assert.equal(seed.status, PROCUREMENT_READY_STATUS);
  assert.equal(seed.executionMode, PROCUREMENT_EXECUTION_MODE);
  assert.equal(seed.executionMode, "manual_only");
  assert.equal(seed.expectedUnitCostCents, 2375);
  assert.equal(seed.expectedTotalCostCents, 4750);
  assert.equal(seed.currency, "usd");
  assert.equal(seed.blockedReason, null);
});

test("legacy order without immutable source provenance is blocked instead of guessed", () => {
  const seed = deriveProcurementIntentSeed(
    {
      id: "legacy-item",
      orderId: "legacy-order",
      quantity: 1,
      landedCostCents: 2375,
      supplierSnapshot: "{}",
    },
    "usd",
  );

  assert.equal(seed.status, PROCUREMENT_BLOCKED_STATUS);
  assert.equal(seed.executionMode, "manual_only");
  assert.equal(seed.blockedReason, PROCUREMENT_BLOCKED_REASON);
  assert.equal(seed.expectedUnitCostCents, null);
  assert.equal(seed.expectedTotalCostCents, null);
});

test("tampered or mismatched source economics fail closed", () => {
  const malformed = JSON.parse(validSnapshot()) as Record<string, unknown>;
  malformed.costBreakdown = {
    itemCostCents: 2000,
    shippingCents: 200,
    taxCents: 100,
    supplierFeeCents: 50,
    handlingCents: 25,
    landedCostCents: 9999,
  };
  assert.equal(parseProcurementSupplierSnapshot(JSON.stringify(malformed)), null);

  const currencyMismatch = deriveProcurementIntentSeed(
    {
      id: "item-a",
      orderId: "order-a",
      quantity: 1,
      landedCostCents: 2375,
      supplierSnapshot: validSnapshot({ currency: "eur" }),
    },
    "usd",
  );
  assert.equal(currencyMismatch.status, PROCUREMENT_BLOCKED_STATUS);

  const landedCostMismatch = deriveProcurementIntentSeed(
    {
      id: "item-a",
      orderId: "order-a",
      quantity: 1,
      landedCostCents: 2400,
      supplierSnapshot: validSnapshot(),
    },
    "usd",
  );
  assert.equal(landedCostMismatch.status, PROCUREMENT_BLOCKED_STATUS);
});

test("Prisma schemas and migration enforce one durable intent per order line", async () => {
  const sqlite = await readFile("prisma/schema.prisma", "utf8");
  const postgres = await readFile("prisma/schema.postgres.prisma", "utf8");
  const migration = await readFile(
    "prisma/migrations/20260825021000_procurement_intent_journal_v1/migration.sql",
    "utf8",
  );

  for (const schema of [sqlite, postgres]) {
    assert.match(schema, /model ProcurementIntent/);
    assert.match(schema, /orderItemId\s+String\s+@unique/);
    assert.match(schema, /executionMode\s+String\s+@default\("manual_only"\)/);
    assert.match(schema, /model ProcurementEvent/);
    assert.match(schema, /eventKey\s+String\s+@unique/);
  }
  assert.match(migration, /CREATE TABLE "ProcurementIntent"/);
  assert.match(migration, /CREATE TABLE "ProcurementEvent"/);
  assert.match(migration, /ProcurementIntent_orderItemId_key/);
  assert.doesNotMatch(migration, /INSERT INTO "ProcurementIntent"/);
});

test("verified Stripe payment creates procurement intents atomically only after paid financial state", async () => {
  const webhook = await readFile("src/app/api/stripe/webhook/route.ts", "utf8");
  assert.match(webhook, /ensureProcurementIntentsForPaidOrder/);
  assert.match(webhook, /deriveFinancialOrderStatus/);

  const paidGate = webhook.indexOf('if (financial.status === "paid")');
  const journal = webhook.indexOf("await ensureProcurementIntentsForPaidOrder(tx, orderId)");
  const transaction = webhook.indexOf("prisma.$transaction");
  assert.ok(paidGate >= 0, "missing verified paid financial-state gate");
  assert.ok(journal > paidGate, "procurement intent creation must follow paid financial-state verification");
  assert.ok(transaction > journal, "webhook handler must preserve its encompassing Prisma transaction");

  const library = await readFile("src/lib/procurement-intents.ts", "utf8");
  assert.match(library, /order\.status !== "paid"/);
  assert.match(library, /executionMode: PROCUREMENT_EXECUTION_MODE/);
  assert.match(library, /update: \{\}/);
  assert.doesNotMatch(library, /fetch\(/);
  assert.doesNotMatch(library, /supplier.*purchase/i);
});
