# Cloudflare deploy guard

DealForge's Wrangler configuration declares a custom build command that verifies `.open-next/worker.js` exists before any Wrangler deploy or version upload.

Why this exists:

- Cloudflare Workers Builds may run a generic or empty framework build command before invoking Wrangler.
- DealForge requires `npm run cf:build` to generate the OpenNext Worker artifact.
- `scripts/ensure-cloudflare-build.mjs` is idempotent: it skips the build when the artifact already exists and creates it when missing.
- Core runtime secrets (`DATABASE_URL` and `AUTH_SECRET`) remain deploy-time requirements.
- Stripe secrets remain mandatory for payment execution and webhook verification, but they are enforced fail-closed by the payment code rather than preventing the entire storefront from deploying. Commerce products remain disabled until the Stripe certification gate is complete.

This keeps the repository, not a dashboard-only setting, responsible for producing the deployable Worker bundle while preserving availability of the non-payment storefront.
