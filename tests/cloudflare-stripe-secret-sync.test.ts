import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Cloudflare webhook sync preserves Stripe secret modes and the legacy fallback name", async () => {
  const source = await readFile(".github/workflows/cloudflare-stripe-secret-sync.yml", "utf8");

  assert.match(source, /STRIPE_WEBHOOK_SECRET_LIVE: \$\{\{ secrets\.STRIPE_WEBHOOK_SECRET_LIVE \}\}/);
  assert.match(source, /STRIPE_WEBHOOK_SECRET_TEST: \$\{\{ secrets\.STRIPE_WEBHOOK_SECRET_TEST \}\}/);
  assert.match(source, /STRIPE_WEBHOOK_SECRET_LEGACY: \$\{\{ secrets\.STRIPE_WEBHOOK_SECRET \}\}/);

  assert.match(
    source,
    /write_secret STRIPE_WEBHOOK_SECRET_LIVE "\$\{STRIPE_WEBHOOK_SECRET_LIVE:-\}"/,
  );
  assert.match(
    source,
    /write_secret STRIPE_WEBHOOK_SECRET_TEST "\$\{STRIPE_WEBHOOK_SECRET_TEST:-\}"/,
  );
  assert.match(
    source,
    /write_secret STRIPE_WEBHOOK_SECRET "\$\{STRIPE_WEBHOOK_SECRET_LEGACY:-\}"/,
  );
  assert.doesNotMatch(
    source,
    /write_secret STRIPE_WEBHOOK_SECRET_TEST "\$\{STRIPE_WEBHOOK_SECRET_LEGACY:-\}"/,
  );
});

test("production deploy synchronizes available webhook secrets before publishing", async () => {
  const source = await readFile(".github/workflows/cloudflare-production-deploy.yml", "utf8");

  const syncIndex = source.indexOf("Synchronize Stripe webhook secrets when GitHub sources exist");
  const deployIndex = source.indexOf("Deploy exact main revision");
  assert.ok(syncIndex >= 0, "missing webhook-secret synchronization step");
  assert.ok(deployIndex >= 0, "missing production deploy step");
  assert.ok(syncIndex < deployIndex, "webhook secrets must be synchronized before production publish");

  assert.match(source, /STRIPE_WEBHOOK_SECRET_LIVE: \$\{\{ secrets\.STRIPE_WEBHOOK_SECRET_LIVE \}\}/);
  assert.match(source, /write_secret STRIPE_WEBHOOK_SECRET_LIVE STRIPE_WEBHOOK_SECRET_LIVE/);
  assert.match(source, /write_secret STRIPE_WEBHOOK_SECRET_TEST STRIPE_WEBHOOK_SECRET_TEST/);
  assert.match(source, /write_secret STRIPE_WEBHOOK_SECRET STRIPE_WEBHOOK_SECRET/);
});

test("live smoke requires the webhook route to reach signature verification", async () => {
  for (const path of [
    ".github/workflows/cloudflare-stripe-secret-sync.yml",
    ".github/workflows/cloudflare-production-deploy.yml",
  ]) {
    const source = await readFile(path, "utf8");
    assert.match(source, /INVALID_STRIPE_SIGNATURE/);
    assert.doesNotMatch(source, /\[\[ "\$webhook_code" == '400' \]\] && break/);
  }
});
