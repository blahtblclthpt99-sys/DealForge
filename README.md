# DealForge

DealForge is a commerce platform that discovers products from verified suppliers, calculates landed cost, sets a DealForge selling price, accepts customer payment through DealForge, then sources and fulfills the order while retaining the resulting margin.

The current operating model is:

**DISCOVER → VERIFY → IMPORT → CALCULATE LANDED COST → PRICE → PUBLISH → SELL → SOURCE → FULFILL → SUPPORT → RECONCILE → OPTIMIZE**

DealForge is no longer designed as an affiliate-link-first storefront. Legacy affiliate/provider metadata may still exist in the repository for source discovery or historical compatibility, but customer financial truth must come from DealForge's own order ledger and verified Stripe events.

## Stack

- **Next.js 15.5 compatibility line** + TypeScript + Tailwind CSS, pinned for the current Cloudflare/OpenNext payment-certification release
- **Cloudflare Workers + OpenNext** for production runtime and deployment
- **Prisma** + PostgreSQL in production
- **JWT sessions** with bcrypt password hashing
- **Stripe Checkout** for DealForge-owned checkout
- **Verified Stripe webhooks** as authoritative payment state
- **Order, payment, payment-event, and refund ledgers**
- **Product Engine** for controlled product discovery and intake
- **Background workers** for catalog and operational processing

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
11. Only after all checks pass may broader commerce automation be enabled.

Products are intentionally `commerceEnabled=false` by default until this gate is passed.

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
- Do not enable autonomous supplier purchasing until payment, refund, reconciliation, and order-integrity certification are complete.
- Keep supplier/source verification and landed-cost controls ahead of publication.
- Keep the Cloudflare/OpenNext compatibility pin unchanged during Phase 2.5 certification; framework upgrades require their own tested release.

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
