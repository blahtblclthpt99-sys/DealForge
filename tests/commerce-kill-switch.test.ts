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

test("operational lock blocks runtime commerce without becoming a destructive monitor reason", async () => {
  const gate = await readFile("src/lib/commerce-gate.ts", "utf8");
  const monitor = await readFile("src/lib/commerce-monitor.ts", "utf8");
  assert.match(gate, /broad_catalog_commerce_locked/);
  assert.match(monitor, /NON_MUTATING_OPERATIONAL_REASONS/);
  assert.match(monitor, /broad_catalog_commerce_locked/);
  assert.match(monitor, /if \(safetyReasons\.length === 0\) continue/);
});

test("Stripe certification bypass remains test-mode-only and explicitly scoped", async () => {
  const checkout = await readFile("src/app/api/checkout/route.ts", "utf8");
  const catalog = await readFile("src/lib/certification-catalog.ts", "utf8");

  assert.match(checkout, /certificationBypass = certificationOnly && isStripeTestMode\(\)/);
  assert.match(checkout, /if \(!commerceEnabled\(\) && !certificationBypass\)/);
  assert.match(checkout, /catalogCertificationOnly/);
  assert.match(checkout, /legacyCertificationOnly/);
  assert.match(checkout, /PRODUCT_NOT_IN_CERTIFICATION_CATALOG/);
  assert.match(checkout, /CERTIFICATION_PRODUCT_NOT_AUTHORIZED/);
  assert.match(checkout, /if \(certificationOnly && isStripeTestMode\(\)\) continue/);

  assert.match(catalog, /CERTIFICATION_CATALOG_PRODUCT_IDS/);
  assert.match(catalog, /isCertificationCatalogProduct/);
  assert.match(catalog, /isLegacyStripeCertificationProduct/);
  assert.match(catalog, /startsWith\("sk_test_"\)/);
});
