import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("checkout selects and passes the migrated supplier verification timestamp", async () => {
  const source = await readFile("src/app/api/checkout/route.ts", "utf8");

  assert.match(source, /priceVerifiedAt: true/);
  assert.match(source, /priceVerifiedAt: product\.priceVerifiedAt/);
  assert.match(source, /PRODUCT_COMMERCE_GATE_FAILED/);
});
