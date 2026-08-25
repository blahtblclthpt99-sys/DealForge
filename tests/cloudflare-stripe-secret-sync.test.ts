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

test("production deploy binds the complete required secret contract atomically to the published Worker version", async () => {
  const source = await readFile(".github/workflows/cloudflare-production-deploy.yml", "utf8");

  const validateIndex = source.indexOf("Validate Stripe webhook secret sources");
  const deployIndex = source.indexOf("Deploy exact main revision with required runtime secrets");
  assert.ok(validateIndex >= 0, "missing webhook-secret validation step");
  assert.ok(deployIndex >= 0, "missing atomic required-secret production deploy step");
  assert.ok(validateIndex < deployIndex, "runtime secrets must be validated before production publish");

  assert.match(source, /DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}/);
  assert.match(source, /AUTH_SECRET: \$\{\{ secrets\.AUTH_SECRET \}\}/);
  assert.match(source, /STRIPE_SECRET_KEY: \$\{\{ secrets\.STRIPE_SECRET_KEY \}\}/);
  assert.match(source, /STRIPE_WEBHOOK_SECRET_LIVE: \$\{\{ secrets\.STRIPE_WEBHOOK_SECRET_LIVE \}\}/);
  assert.match(source, /STRIPE_WEBHOOK_SECRET_TEST: \$\{\{ secrets\.STRIPE_WEBHOOK_SECRET_TEST \}\}/);
  assert.match(source, /STRIPE_WEBHOOK_SECRET_LEGACY: \$\{\{ secrets\.STRIPE_WEBHOOK_SECRET \}\}/);

  assert.match(
    source,
    /const required = \['DATABASE_URL', 'AUTH_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET_TEST'\]/,
  );
  assert.match(source, /DATABASE_URL: 'DATABASE_URL'/);
  assert.match(source, /AUTH_SECRET: 'AUTH_SECRET'/);
  assert.match(source, /STRIPE_SECRET_KEY: 'STRIPE_SECRET_KEY'/);
  assert.match(source, /STRIPE_WEBHOOK_SECRET_LEGACY: 'STRIPE_WEBHOOK_SECRET'/);
  assert.match(source, /STRIPE_SECRET_KEY must be test-mode/);
  assert.match(source, /STRIPE_WEBHOOK_SECRET_TEST missing or invalid/);
  assert.match(source, /--secrets-file "\$secrets_file"/);
  assert.match(source, /chmod 600 "\$secrets_file"/);
  assert.doesNotMatch(source, /wrangler versions secret put/);
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
