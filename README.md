# DealForge

DealForge is an affiliate product-discovery platform. It helps shoppers discover products and then routes purchases to approved retailer destinations; DealForge does not sell or fulfill inventory itself.

## Stack

- **Next.js 15** App Router + TypeScript + Tailwind CSS v4
- **Cloudflare Workers + OpenNext** for the production web runtime
- **Prisma + Neon PostgreSQL** for production data
- **SQLite** for local development and isolated CI
- **JWT sessions** with password hashing and database revalidation for protected operations
- **Modular affiliate connectors** with destination allowlisting
- **Request-scoped Prisma/Neon access** in Cloudflare Workers
- **Cloudflare Cron Trigger** for bounded maintenance work
- **Redis-ready caching** with memory/database fallback

## Quick start

```bash
npm install
cp .env.example .env
npm run db:setup
npm run dev
```

`npm run db:setup` is intended for the local SQLite development database. Open `http://localhost:3000` after startup.

## Production architecture

The active production candidate is:

**GitHub → Cloudflare Workers Builds → OpenNext Worker → existing DealForge Neon PostgreSQL database**

The preserved Koyeb migration branch remains a fallback until Cloudflare and the custom domains are fully certified. See `DEPLOYMENT-KOYEB.md` only for fallback/recovery context; it is not the current release target.

### Cloudflare build

The repository uses:

```bash
npm run cf:build
npm run cf:dry-run
```

The Cloudflare Git build must run `npm run cf:build` before deployment so `.open-next/worker.js` exists. The Wrangler entrypoint is the thin `cloudflare/worker.mjs` wrapper, which delegates HTTP traffic to OpenNext and adds scheduled maintenance.

Current runtime configuration is defined in `wrangler.jsonc` and uses Node compatibility for Prisma/OpenNext support.

### Required production secrets

Configure secrets in Cloudflare; never commit them to Git:

```text
DATABASE_URL=<existing DealForge Neon PostgreSQL connection string>
AUTH_SECRET=<long random secret, at least 32 characters>
```

For verified Amazon price refreshes, also configure:

```text
AMAZON_CREATORS_CREDENTIAL_ID=<Amazon Creators API credential id>
AMAZON_CREATORS_CREDENTIAL_SECRET=<Amazon Creators API credential secret>
AMAZON_CREATORS_CREDENTIAL_VERSION=3.1
```

Public/non-secret runtime configuration includes the DealForge Amazon Associates tag and the application name/domain. Amazon prices are fail-closed: if a trusted current price cannot be verified, the storefront tells the shopper to check the retailer instead of publishing a stale stored amount.

### Production database safety

The existing DealForge Neon project is the source of truth. **Production deploys must never reseed it.**

Safe schema synchronization:

```bash
npm run db:setup:postgres
```

`db:setup:postgres` applies the PostgreSQL schema only. It does not seed or delete production data.

The seed routine is intentionally destructive: it deletes users, products, categories, logs, cache entries, and provider rows before rebuilding a development catalog. All repository commands that invoke it now pass through `scripts/assert-destructive-seed.mjs`.

A non-SQLite destructive reset is refused unless all of the following are intentionally supplied:

```text
DATABASE_URL=<explicit target database>
ALLOW_DESTRUCTIVE_SEED=RESET_DEALFORGE_DATABASE
ADMIN_EMAIL=<explicit admin email>
ADMIN_PASSWORD=<explicit strong password, at least 16 characters>
```

The explicit destructive PostgreSQL command is `npm run db:reset:postgres`. Do not use it for normal deployment or migration work.

### Scheduled maintenance

`wrangler.jsonc` configures a five-minute Cron Trigger. The Cloudflare wrapper signs each maintenance dispatch with HMAC-SHA256 using `AUTH_SECRET`; `/api/internal/maintenance` rejects unsigned or stale requests.

The bounded Cloudflare maintenance cycle handles:

- verified Amazon price refresh attempts
- expired flash-deal cleanup
- expired cache cleanup
- price-alert evaluation

Price alerts are edge-triggered: a verified price crossing below a target triggers once and is re-armed only after a later verified price rises above that target. Stale/unverified prices neither trigger nor reset alerts.

The legacy full-catalog trending rewrite is intentionally omitted from the Cloudflare Cron path because public discovery already ranks directly from first-party click/view/recency fields and rewriting the entire catalog every five minutes is unnecessary.

### Custom domain release gate

The intended production domains are:

- `https://www.deal-forge.sale`
- `https://deal-forge.sale`

Do not treat the migration as production-certified until both domains point at the certified Cloudflare Worker and the live release workflow passes the same route, affiliate, image-proxy, auth, and exact-build checks used on `workers.dev`.

The live workflows use `/api/build` to verify the exact deployed Git SHA. A healthy older Worker does not satisfy the release gate.

## Release gates

The migration branch currently defines four complementary gates:

1. **DealForge Quality Gate** — install, isolated database, lint, catalog tooling, security fixtures, production build, route/security tests, dependency audit.
2. **DealForge Cloudflare Candidate** — OpenNext/workerd build, Wrangler dry-run, Free-plan compressed-bundle limit, dependency audit.
3. **DealForge Live Worker Smoke** — exact deployed SHA, storefront routes, verified-price safety, affiliate redirect policy, image-proxy SSRF controls, protected-route behavior, diagnostics removal, and custom-domain certification.
4. **DealForge Live Auth Smoke** — exact deployed SHA, browser security headers/origin policy, disposable registration, logout/login, password-confirmed account deletion, and post-deletion authentication rejection.

PR #3 remains draft until the production-domain and live certification gates are fully green.

## Catalog maintenance

Catalog link validation is intentionally **non-destructive by default**. A listing must be classified dead twice before it is reported as confirmed dead, and ambiguous/blocked/error results are left untouched.

| Command | Purpose |
|---|---|
| `npm run catalog:validate` | Report Amazon listing health without deleting products |
| `npm run catalog:validate -- --dry-run` | Explicit report-only scan |
| `npm run catalog:validate -- --delete-confirmed` | Delete only listings independently confirmed dead twice |
| `npm run catalog:repair-images` | Repair product images |
| `npm run catalog:sync-images` | Synchronize product images |
| `npm run catalog:refresh-prices` | Refresh catalog prices through configured approved sources |
| `npm run worker -- --once` | Run one traditional Node maintenance pass for local/fallback use |

Commands such as catalog discovery/refresh that rebuild through the seed routine inherit the destructive-seed guard.

## Commerce integrity

Public product visibility and commerce data are fail-closed:

- enrichment-only and explicitly blocked catalog rows are excluded from public storefront queries and ID-based user actions
- wishlist, recent-history, click, alert, and affiliate-redirect paths use the same public visibility policy
- stale/unverified Amazon amounts are not presented as current prices
- affiliate redirects are rebuilt/validated against retailer-specific HTTPS host allowlists
- the image proxy validates HTTPS, allowed hosts, redirect destinations, content type, and response size

## Account and browser security

- production `AUTH_SECRET` must be at least 32 characters
- protected user/admin operations re-check the current database record instead of trusting a long-lived JWT role alone
- state-changing browser API calls enforce same-origin policy in middleware
- Cloudflare client IP is preferred for best-effort per-isolate throttling
- account deletion requires the current password and cannot remove the final administrator
- baseline security headers include clickjacking, MIME-sniffing, referrer, permissions, opener/resource, and HSTS protections

## Pages

- `/` — Home
- `/categories`, `/categories/[slug]`
- `/product/[slug]` — Product detail + retailer CTA
- `/search` — Search, filters, and sort
- `/deals` — Deals discovery
- `/dashboard/*` — Wishlist, saved searches, recent products, price alerts, settings
- `/admin` — Administrative operations

## Affiliate disclosure

The storefront states that product links may be affiliate links and that DealForge may earn commissions from qualifying purchases. Amazon links use the configured DealForge Associates tag.
