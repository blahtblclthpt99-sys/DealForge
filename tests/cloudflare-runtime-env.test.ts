import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildAliExpressAffiliateUrl } from "../src/lib/affiliate/aliexpress-config";
import { buildAmazonProductUrl } from "../src/lib/affiliate/amazon-config";
import { buildEbayAffiliateUrl } from "../src/lib/affiliate/ebay-config";
import { hydrateCloudflareProcessEnv } from "../src/lib/cloudflare-runtime-env";

test("Cloudflare runtime env bridge copies only string bindings", () => {
  const target: Record<string, string | undefined> = { EXISTING: "keep" };
  hydrateCloudflareProcessEnv(
    {
      STRIPE_SECRET_KEY: "sk_test_example",
      STRIPE_WEBHOOK_SECRET_TEST: "whsec_example",
      EMPTY: "",
      OBJECT_BINDING: { type: "assets" },
      NUMBER_BINDING: 42,
    },
    target,
  );

  assert.equal(target.STRIPE_SECRET_KEY, "sk_test_example");
  assert.equal(target.STRIPE_WEBHOOK_SECRET_TEST, "whsec_example");
  assert.equal(target.EMPTY, "");
  assert.equal(target.EXISTING, "keep");
  assert.equal(target.OBJECT_BINDING, undefined);
  assert.equal(target.NUMBER_BINDING, undefined);
});

test("custom Worker hydrates bindings before OpenNext fetch and scheduled execution", async () => {
  const source = await readFile("custom-worker.ts", "utf8");

  assert.match(source, /import \{ hydrateCloudflareProcessEnv \}/);
  assert.match(
    source,
    /async fetch\([\s\S]*?hydrateCloudflareProcessEnv\(env\);[\s\S]*?return handler\.fetch\(request, env, ctx\);/,
  );
  assert.match(
    source,
    /async scheduled\([\s\S]*?hydrateCloudflareProcessEnv\(env\);[\s\S]*?resolveMaintenanceToken\(env\)/,
  );
  assert.doesNotMatch(source, /console\.(?:log|error).*STRIPE_WEBHOOK_SECRET/);
});

test("runtime affiliate links observe bindings hydrated after module initialization", () => {
  const names = [
    "AMAZON_ASSOCIATE_TAG",
    "AMAZON_PARTNER_TAG",
    "EBAY_AFFILIATE_SID",
    "EBAY_AFFILIATE_TRACKING_ID",
    "ALIEXPRESS_AFF_SHORT_KEY",
    "ALIEXPRESS_TRACKING_ID",
    "ALIEXPRESS_PUBLISHER_ID",
  ] as const;
  const before = new Map(names.map((name) => [name, process.env[name]]));

  try {
    hydrateCloudflareProcessEnv({
      AMAZON_ASSOCIATE_TAG: "runtime-amazon-20",
      EBAY_AFFILIATE_SID: "runtime-ebay-sid",
      EBAY_AFFILIATE_TRACKING_ID: "runtime-ebay-campaign",
      ALIEXPRESS_AFF_SHORT_KEY: "runtime-ali-key",
      ALIEXPRESS_PUBLISHER_ID: "runtime-ali-publisher",
    });

    const amazon = new URL(buildAmazonProductUrl("b000test01"));
    assert.equal(amazon.searchParams.get("tag"), "runtime-amazon-20");

    const ebay = new URL(buildEbayAffiliateUrl({ itemId: "123456789" }));
    assert.equal(ebay.hostname, "rover.ebay.com");
    assert.equal(ebay.searchParams.get("customid"), "runtime-ebay-sid");
    assert.equal(ebay.searchParams.get("campid"), "runtime-ebay-campaign");

    const ali = new URL(buildAliExpressAffiliateUrl({ productId: "1005000000000" }));
    assert.equal(ali.hostname, "s.click.aliexpress.com");
    assert.equal(ali.searchParams.get("aff_short_key"), "runtime-ali-key");
    assert.equal(ali.searchParams.get("af"), "runtime-ali-publisher");
  } finally {
    for (const name of names) {
      const value = before.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
