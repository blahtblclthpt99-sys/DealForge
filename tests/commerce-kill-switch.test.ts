import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BROAD_CATALOG_COMMERCE_LOCKED,
  isBroadCatalogCommerceEnabled,
} from "../src/lib/commerce-switch";

test("broad catalog commerce remains locked even if COMMERCE_ENABLED is true", () => {
  assert.equal(BROAD_CATALOG_COMMERCE_LOCKED, true);
  assert.equal(isBroadCatalogCommerceEnabled({ COMMERCE_ENABLED: "true" }), false);
  assert.equal(isBroadCatalogCommerceEnabled({ COMMERCE_ENABLED: "false" }), false);
});

test("commercial gate enforces the repository kill switch", async () => {
  const source = await readFile("src/lib/commerce-gate.ts", "utf8");
  assert.match(source, /isBroadCatalogCommerceEnabled/);
  assert.match(source, /broad_catalog_commerce_locked/);
});

test("private Stripe certification bypass remains isolated in checkout", async () => {
  const checkout = await readFile("src/app/api/checkout/route.ts", "utf8");
  assert.match(checkout, /certificationBypass = certificationOnly && stripeTestMode\(\)/);
  assert.match(checkout, /if \(!commerceEnabled\(\) && !certificationBypass\)/);
  assert.match(checkout, /if \(certificationOnly && isInternalCertificationProduct\(product\.specifications\) && stripeTestMode\(\)\) continue/);
});
