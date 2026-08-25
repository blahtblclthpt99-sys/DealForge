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

test("custom Worker hydrates Cloudflare bindings before OpenNext initializes", async () => {
  const source = await readFile("custom-worker.ts", "utf8");

  assert.match(source, /import \{ env as cloudflareEnv \} from "cloudflare:workers"/);
  assert.match(source, /import \{ hydrateCloudflareProcessEnv \}/);

  const initialHydration = source.indexOf(
    "hydrateCloudflareProcessEnv(cloudflareEnv as Record<string, unknown>);",
  );
  const openNextImport = source.indexOf(
    'await import("./.open-next/worker.js")',
  );

  assert.ok(initialHydration >= 0, "expected module-scope Cloudflare env hydration");
  assert.ok(openNextImport > initialHydration, "OpenNext must load after env hydration");

  assert.doesNotMatch(
    source,
    /import\s+nextWorker\s+from\s+["']\.\/\.open-next\/worker\.js["']/,
  );
  assert.doesNotMatch(
    source,
    /export\s*\{[^}]*DOQueueHandler[^}]*\}\s*from\s*["']\.\/\.open-next\/worker\.js["']/,
  );

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
