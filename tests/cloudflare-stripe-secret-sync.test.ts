import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Cloudflare webhook sync preserves Stripe secret modes and the legacy fallback name", async () => {
  const source = await readFile(".github/workflows/cloudflare-stripe-secret-sync.yml", "utf8");

  assert.match(source, /STRIPE_WEBHOOK_SECRET_LIVE: \$\{\{ secrets\.STRIPE_WEBHOOK_SECRET_LIVE \}\}/);
  assert.match(source, /STRIPE_WEBHOOK_SECRET_TEST: \$\{\{ secrets\.STRIPE_WEBHOOK_SECRET_TEST \}\}/);
  assert.match(source, /STRIPE_WEBHOOK_SECRET_LEGACY: \$\{\{ secrets\.STRIPE_WEBHOOK_SECRET \}\}/);

  assert.match(source, /write_secret STRIPE_WEBHOOK_SECRET_LIVE "\$\{STRIPE_WEBHOOK_SECRET_LIVE:-\}"/);
  assert.match(source, /write_secret STRIPE_WEBHOOK_SECRET_TEST "\$\{STRIPE_WEBHOOK_SECRET_TEST:-\}"/);
  assert.match(source, /write_secret STRIPE_WEBHOOK_SECRET "\$\{STRIPE_WEBHOOK_SECRET_LEGACY:-\}"/);
  assert.doesNotMatch(source, /write_secret STRIPE_WEBHOOK_SECRET_TEST "\$\{STRIPE_WEBHOOK_SECRET_LEGACY:-\}"/);
});

test("Cloudflare secret-mutating workflows serialize and deploy secret changes immediately", async () => {
  const sync = await readFile(".github/workflows/cloudflare-stripe-secret-sync.yml", "utf8");
  const deploy = await readFile(".github/workflows/cloudflare-production-deploy.yml", "utf8");
  const certification = await readFile(".github/workflows/inventory-adapter-certification.yml", "utf8");

  for (const source of [sync, deploy, certification]) {
    assert.match(source, /group: dealforge-cloudflare-production/);
    assert.match(source, /cancel-in-progress: false/);
  }

  assert.match(sync, /wrangler secret put "\$cloudflare_name" --name dealforge/);
  assert.doesNotMatch(sync, /wrangler versions secret put/);
});

test("production deploy supplies the complete required Cloudflare runtime secret contract atomically", async () => {
  const source = await readFile(".github/workflows/cloudflare-production-deploy.yml", "utf8");

  const validateIndex = source.indexOf("Validate deployment-owned secret sources");
  const deployIndex = source.indexOf("Deploy exact main revision with complete required runtime secret contract");
  assert.ok(validateIndex >= 0, "missing deployment-secret validation step");
  assert.ok(deployIndex >= 0, "missing atomic production deploy step");
  assert.ok(validateIndex < deployIndex, "required runtime secrets must be validated before publish");

  for (const name of ["DATABASE_URL", "AUTH_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET_TEST"]) {
    assert.match(
      source,
      new RegExp(`${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`),
      `${name} must come from GitHub Actions secrets`,
    );
    assert.match(source, new RegExp(`'${name}'`), `${name} must be written to the restricted Wrangler secrets file`);
  }

  assert.match(source, /--secrets-file "\$secrets_file"/);
  assert.match(source, /chmod 600 "\$secrets_file"/);
  assert.match(source, /STRIPE_SECRET_KEY missing or invalid/);
  assert.match(source, /STRIPE_WEBHOOK_SECRET_TEST missing or invalid/);
  assert.doesNotMatch(source, /wrangler versions secret put/);
  assert.doesNotMatch(source, /Cloudflare owns DATABASE_URL, AUTH_SECRET, and STRIPE_SECRET_KEY/);
});

test("Cloudflare publish guard enforces the currently certified Stripe test-mode contract", async () => {
  const source = await readFile("scripts/ensure-cloudflare-build.mjs", "utf8");

  assert.match(source, /stripeKey\.startsWith\("sk_live_"\)/);
  assert.match(source, /Stripe live mode is not certified for DealForge production yet/);
  assert.match(source, /stripeKey\.startsWith\("sk_test_"\)/);
  assert.match(source, /STRIPE_WEBHOOK_SECRET_TEST must be configured/);
  assert.match(source, /Stripe deployment mode verified: test/);

  const validateIndex = source.indexOf("validateCertifiedStripeMode();");
  const artifactIndex = source.indexOf("if (await artifactExists())");
  assert.ok(validateIndex >= 0, "missing Stripe deployment-mode validation");
  assert.ok(artifactIndex >= 0, "missing artifact bootstrap check");
  assert.ok(validateIndex < artifactIndex, "Stripe mode must be validated even when the OpenNext artifact already exists");
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
