# DealForge Catalog & Commerce Operations

This document is the release policy for product discovery, source verification, landed cost, DealForge selling price, catalog publication, customer checkout, sourcing, fulfillment, and profit protection.

## Canonical business model

DealForge is a **merchant-of-record commerce platform**, not an affiliate-link-first storefront.

Canonical transaction model:

**DISCOVER PRODUCT → VERIFY SOURCE → IMPORT PRODUCT → CALCULATE LANDED COST → SET DEALFORGE SELLING PRICE → CUSTOMER PURCHASES FROM DEALFORGE → DEALFORGE SOURCES/FULFILLS ORDER → DEALFORGE RETAINS MARGIN**

Legacy affiliate fields, redirect routes, provider tables, and scripts may remain for migration compatibility or optional referral use, but they are not the source of truth for the primary DealForge business model and must not be used to silently revert checkout to retailer handoff.

## Phase 2.5 certification state

As of August 22, 2026, production has verified:

- server-authoritative Stripe Checkout creation;
- live Stripe-hosted Checkout reachability;
- a real live-card payment attempt;
- correct decline handling with zero funds captured;
- authoritative `payment_intent.payment_failed` webhook processing;
- DealForge failed-payment ledger persistence;
- checkout idempotency for duplicate creation requests;
- Managed Payments explicitly disabled for DealForge physical-goods Checkout;
- refund API/webhook race hardening in CI.

A successful live settlement followed by a live refund has not yet been exercised. Therefore Phase 3 catalog, verification, pricing, publication-control, analytics, and non-money automation may proceed. New broad commerce enablement, unattended supplier purchasing, unattended refund execution, marketplace transfers, commissions, and payouts remain gated until successful settlement/refund reconciliation is observed in production.

## Product price trust model

DealForge separates supplier/source cost from the price charged to the customer.

- **Verified source cost**: amount obtained from an approved source within its freshness window.
- **Landed cost**: verified source cost plus known shipping, tax, handling, procurement, and other unavoidable per-order costs.
- **DealForge selling price**: the customer-facing amount calculated from landed cost plus required payment costs and profit policy.
- **Unverified/stale source cost**: never eligible for autonomous price publication or autonomous procurement.
- A failed refresh must never advance a source-price timestamp or make stale cost data appear fresh.
- HTML scraping may not be treated as authoritative production price truth when a retailer prohibits it or a supported API/feed is required.

## Dynamic pricing rules

All automated pricing must use integer cents. Floating-point catalog fields are legacy/display compatibility only and must not be the financial source of truth.

A generated selling price must satisfy every applicable rule:

1. landed cost is positive and verified;
2. target gross margin is met after estimated payment processing costs;
3. minimum absolute profit is met;
4. configured price floor is met;
5. configured price ceiling is not exceeded;
6. currency matches the source/order currency policy;
7. stale or ambiguous cost data fails closed;
8. a cap violation makes the product ineligible instead of silently lowering margin.

Pricing calculations are advisory until a publication action explicitly writes the approved `sellingPriceCents` to a product.

## Source verification

Before a product may be marked commerce-ready, DealForge must retain enough source information to re-verify:

- retailer/supplier identity;
- canonical product URL or supplier identifier;
- current source cost and currency;
- availability state;
- verification timestamp;
- quantity/pack-size interpretation when relevant;
- shipping or minimum-order assumptions when relevant.

Unknown, unsafe, malformed, or unsupported supplier destinations fail closed.

## Catalog publication

`commerceEnabled=true` means DealForge itself is prepared to sell the item. It must not merely mean an outbound affiliate link exists.

A product must not be broadly enabled for commerce unless:

- landed cost is known;
- a selling price in cents is present and passes profit policy;
- source availability is current;
- source identity is approved;
- customer-facing title/images/quantity are not materially misleading;
- fulfillment is operationally possible;
- payment certification requirements for the intended rollout stage are satisfied.

## Sourcing and fulfillment gate

Automatic supplier purchasing is a money-moving action and remains disabled during guarded Phase 3.

Until the settlement/refund portion of Phase 2.5 is fully observed in production, Phase 3 may automate:

- discovery;
- source verification;
- catalog import preparation;
- landed-cost calculation;
- DealForge price calculation;
- profitability scoring;
- stale-price detection;
- publication recommendations;
- inventory/availability monitoring;
- operational alerts.

It must not autonomously execute supplier purchases, payouts, transfers, or unreviewed refunds.

## Legacy affiliate behavior

Legacy affiliate components are compatibility-only unless a future feature explicitly uses a referral model.

- Affiliate revenue must never be assumed in DealForge profit calculations for merchant-of-record orders.
- `/go/[productId]` must not replace DealForge Checkout for products sold directly by DealForge.
- Old Amazon/eBay/affiliate verification scripts may remain for legacy records but are not a commerce-readiness gate for direct DealForge sales unless that provider is being used as a verified source.

## Release gates

Before a Phase 3 commerce/pricing release:

1. `npm ci`
2. `npm run lint`
3. `npx tsc --noEmit`
4. `npm run test:pricing`
5. existing Stripe payment-integrity tests
6. Cloudflare/OpenNext build
7. Wrangler dry-run
8. production dependency audit
9. verify no product was unintentionally commerce-enabled
10. verify any published selling price satisfies landed-cost/profit policy
11. smoke-test `www.deal-forge.sale`
12. keep bare-apex routing tracked separately until its stale Vercel/DNS conflict is removed

No release may be called production-certified solely because it builds or deploys.
