# Cloudflare deploy repair

DealForge uses a Wrangler custom build guard so `wrangler deploy` and `wrangler versions upload` cannot proceed without a generated `.open-next/worker.js` artifact. If the artifact is absent, the guard runs `npm run cf:build`; if it already exists, the guard skips duplicate work. This keeps the OpenNext build requirement in repository source control instead of relying only on Cloudflare dashboard build settings.
