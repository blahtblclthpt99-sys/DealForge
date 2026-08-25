import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const workerArtifact = fileURLToPath(new URL("../.open-next/worker.js", import.meta.url));

function validateCertifiedStripeMode(env = process.env) {
  const stripeKey = (env.STRIPE_SECRET_KEY || "").trim();
  const testWebhookSecret = (env.STRIPE_WEBHOOK_SECRET_TEST || "").trim();
  const liveWebhookSecret = (env.STRIPE_WEBHOOK_SECRET_LIVE || "").trim();
  const stripeRuntimeConfigured = Boolean(stripeKey || testWebhookSecret || liveWebhookSecret);

  // Local bootstrap may run without Stripe. Once any Stripe runtime credential is
  // present, fail closed unless the complete currently-certified contract exists.
  if (!stripeRuntimeConfigured) return;

  if (stripeKey.startsWith("sk_live_")) {
    console.error(
      "[cloudflare-build] Stripe live mode is not certified for DealForge production yet. " +
        "Use the certified sk_test_ key with STRIPE_WEBHOOK_SECRET_TEST, or perform a deliberate live-mode certification before switching modes.",
    );
    process.exit(1);
  }

  if (!stripeKey.startsWith("sk_test_")) {
    console.error("[cloudflare-build] STRIPE_SECRET_KEY must be a valid sk_test_ key for the current certified deployment mode.");
    process.exit(1);
  }

  if (!testWebhookSecret.startsWith("whsec_")) {
    console.error("[cloudflare-build] STRIPE_WEBHOOK_SECRET_TEST must be configured for the current certified deployment mode.");
    process.exit(1);
  }

  if (liveWebhookSecret) {
    console.log("[cloudflare-build] Live webhook secret is present but inactive; certified deployment mode remains Stripe test mode.");
  }
  console.log("[cloudflare-build] Stripe deployment mode verified: test.");
}

async function artifactExists() {
  try {
    await access(workerArtifact, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

validateCertifiedStripeMode();

if (await artifactExists()) {
  console.log("[cloudflare-build] OpenNext worker artifact already exists; skipping rebuild.");
  process.exit(0);
}

console.log("[cloudflare-build] OpenNext worker artifact missing; building it before Wrangler deploy/upload.");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmCommand, ["run", "cf:build"], {
  cwd: repoRoot,
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error("[cloudflare-build] Failed to start the Cloudflare build:", result.error);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(`[cloudflare-build] Cloudflare build failed with exit code ${result.status ?? "unknown"}.`);
  process.exit(result.status ?? 1);
}

if (!(await artifactExists())) {
  console.error("[cloudflare-build] cf:build completed but .open-next/worker.js was not produced.");
  process.exit(1);
}

console.log("[cloudflare-build] OpenNext worker artifact is ready for Wrangler.");
