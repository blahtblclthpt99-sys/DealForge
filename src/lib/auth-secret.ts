type AuthSecretEnv = {
  AUTH_SECRET?: string;
  NODE_ENV?: string;
};

const DEVELOPMENT_FALLBACK = "dealforge-development-only-secret-not-for-production";
const MIN_PRODUCTION_SECRET_LENGTH = 32;

const BLOCKED_PRODUCTION_SECRETS = new Set([
  "dev-insecure-secret",
  "change-me-to-a-long-random-string",
  "generate-a-long-random-string",
  DEVELOPMENT_FALLBACK,
]);

/**
 * Resolve the HMAC secret used to sign DealForge session tokens.
 *
 * Local development keeps a deterministic fallback so contributors can run the
 * app without provisioning secrets. Production is deliberately fail-closed:
 * no secret, a trivially short secret, or a known placeholder is rejected.
 */
export function resolveAuthSecret(env: AuthSecretEnv = process.env) {
  const configured = (env.AUTH_SECRET || "").trim();
  const production = env.NODE_ENV === "production";

  if (!configured) {
    if (production) throw new Error("AUTH_SECRET_MISSING");
    return DEVELOPMENT_FALLBACK;
  }

  if (production && configured.length < MIN_PRODUCTION_SECRET_LENGTH) {
    throw new Error("AUTH_SECRET_TOO_SHORT");
  }

  if (production && BLOCKED_PRODUCTION_SECRETS.has(configured)) {
    throw new Error("AUTH_SECRET_INSECURE_PLACEHOLDER");
  }

  return configured;
}
