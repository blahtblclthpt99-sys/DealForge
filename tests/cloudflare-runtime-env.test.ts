import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
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
