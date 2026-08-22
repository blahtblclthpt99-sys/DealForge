# Cloudflare deploy fix checkpoint

This checkpoint tracks the repository-level deployment repair that guarantees OpenNext output exists before Wrangler uploads or deploys DealForge.

Validation target:

1. `npm run cf:build`
2. Wrangler custom build guard sees `.open-next/worker.js` and skips duplicate work
3. `wrangler versions upload` / `wrangler deploy` receives a valid OpenNext artifact
4. Existing required Worker secrets remain enforced

Remove this checkpoint later only as normal documentation cleanup; it is not part of runtime behavior.
