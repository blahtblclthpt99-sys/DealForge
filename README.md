# DealForge

DealForge is a controlled commerce platform that discovers products from verified suppliers, calculates landed cost, sets a DealForge selling price, accepts customer payment through DealForge, then sources and fulfills the order while retaining the resulting margin.

The current operating model is:

**DISCOVER → VERIFY → IMPORT → CALCULATE LANDED COST → PRICE → PUBLISH → SELL → SOURCE → FULFILL → SUPPORT → RECONCILE → OPTIMIZE**

DealForge is no longer an affiliate-link-first storefront. Legacy affiliate/provider metadata can remain for source discovery or historical compatibility, but customer financial truth comes from DealForge's order ledger and verified Stripe events.

## Stack

- **Next.js 15.5 compatibility line** + TypeScript + Tailwind CSS, locked for the current Cloudflare/OpenNext payment-certification release
- **Cloudflare Workers + OpenNext** as the primary production runtime
- **Prisma + PostgreSQL** for production persistence
- **JWT sessions** with bcrypt password hashing
- **Stripe Checkout** for DealForge-owned checkout
- **Verified Stripe webhooks** as authoritative payment state
- **Order, payment, payment-event, and refund ledgers**
- **Product Engine** for controlled product discovery and intake
- **Portable standalone/Docker release path** retained as a provider-neutral fallback

## Financial safety gate — Phase 2.5

Commerce remains gated until the complete Stripe transaction lifecycle is certified.

Required certification path:

1. Apply committed PostgreSQL migrations.
2. Configure server-side `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
3. Configure the Stripe webhook endpoint at `/api/stripe/webhook`.
4. Enable only a controlled certification product.
5. Create Checkout from server-authoritative product pricing.
6. Complete a Stripe test-mode payment.
7. Confirm the order changes state from a verified webhook, not from the browser success page.
8. Replay the webhook and verify no duplicate order/payment state is created.
9. Issue a controlled refund and verify the refund ledger and Stripe state reconcile.
10. Reconcile Stripe financial state against DealForge records.
11. Only after every check passes may broader commerce automation be enabled.

Products are intentionally `commerceEnabled=false` by default until this gate passes.

## Release verification

Before promotion, run:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run prisma:validate
npm run build
npm run cf:build
npm run cf:dry-run
```

GitHub Actions runs the DealForge Commerce CI, Product Engine CI, and Cloudflare Workers dry-run gates on pull requests targeting `main`.

## Quick start

```bash
npm install
cp .env.example .env
npm run db:setup
npm run dev
```

## Production requirements

- Use PostgreSQL for `DATABASE_URL`.
- Keep Stripe secrets server-side; never expose them through `NEXT_PUBLIC_*` variables.
- Apply committed migrations before enabling commerce products.
- Use verified Stripe webhook events as financial truth.
- Keep production commerce disabled until Phase 2.5 transaction certification passes.
- Do not enable autonomous supplier purchasing until payment, refund, reconciliation, and order-integrity certification are complete.
- Keep supplier/source verification and landed-cost controls ahead of publication.
- Keep the Cloudflare/OpenNext compatibility line unchanged during Phase 2.5; framework upgrades require a separate tested release.

## Deployment

### Primary — Cloudflare Workers

The repository contains `wrangler.jsonc` and `open-next.config.ts`. The Cloudflare build path produces `.open-next/worker.js` and is exercised by the Workers dry-run CI gate before merge.

The read-only endpoint `/api/build` exposes the embedded build SHA so certification can prove the deployed Worker matches the revision that passed CI. `/api/health` remains available for provider-neutral health checking.

### Portable fallback

DealForge retains a standalone/Docker-compatible production build so deployment is not locked to one provider. Build and health-check the exact release before routing production traffic.

The packaged self-hosted flow also remains available through:

```bash
npm run website:package
```

## Primary pages

- `/` — storefront and deal discovery
- `/categories`, `/categories/[slug]`
- `/product/[slug]` — product detail and DealForge purchase entry point
- `/search` — product search and filters
- `/deals` — active deals
- `/dashboard/*` — customer account features
- `/admin` — controlled catalog and operations management

## Production domain

**https://deal-forge.sale**
