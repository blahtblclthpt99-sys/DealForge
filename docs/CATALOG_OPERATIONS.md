# DealForge Catalog & Commerce Operations

This document is the release policy for product discovery, source verification, landed cost, DealForge selling price, catalog publication, customer checkout, sourcing, fulfillment, and profit protection.

## Canonical business model

DealForge is a **merchant-of-record commerce platform**, not an affiliate-link-first storefront.

Canonical transaction model:

**DISCOVER PRODUCT → VERIFY SOURCE → IMPORT PRODUCT → CALCULATE LANDED COST → SET DEALFORGE SELLING PRICE → CUSTOMER PURCHASES FROM DEALFORGE → DEALFORGE SOURCES/FULFILLS ORDER → DEALFORGE RETAINS MARGIN**

Legacy affiliate fields, redirect routes, provider tables, and scripts may remain for migration compatibility or optional referral use, but they are not the source of truth for the primary DealForge business model and must not be used to silently revert checkout to retailer handoff.

## Phase 2.5 certification state

As of August 22, 2026, the production Stripe path has been exercised end-to-end with real live events and is certified for guarded Phase 3 development.

Verified production evidence includes:

- server-authoritative Stripe Checkout creation;
- live Stripe-hosted Checkout reachability;
- a real live-card decline with zero funds captured;
- authoritative `payment_intent.payment_failed` webhook processing and failed-payment ledger persistence;
- a real successful 75¢ live Checkout payment;
- a succeeded live PaymentIntent with the full amount received;
- authoritative `payment_intent.succeeded` and `checkout.session.completed` webhook processing;
- DealForge order/payment ledger transition to `paid`;
- a successful live full refund;
- authoritative `refund.created` webhook processing;
- DealForge refund ledger persistence and order transition to `refunded`;
- checkout idempotency protections;
- Managed Payments explicitly disabled for DealForge physical-goods Checkout;
- refund API/webhook race hardening covered by CI.

The Phase 2.5 payment gate is therefore **PASS** for Phase 3. This does not itself authorize broad catalog enablement or unattended supplier purchasing; those remain separate operational gates that must be introduced deliberately and tested before autonomous execution.

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

A pricing calculation is advisory until the owner explicitly saves a reviewed recommendation. Persisting `sellingPriceCents` and `landedCostCents` as a recommendation still does **not** make a product purchasable; only the separate activation gate may set `commerceEnabled=true`.

## Commerce eligibility and profitability assessment

The guarded Phase 3 assessment layer combines source verification, landed-cost calculation, payment-fee-aware pricing, margin policy, and a deterministic profitability score.

An assessment can return `ELIGIBLE` or one of these fail-closed block reasons:

- `BLOCKED_FINANCIAL_GATE`
- `BLOCKED_UNVERIFIED_SOURCE`
- `BLOCKED_UNAVAILABLE`
- `BLOCKED_STALE_SOURCE`
- `BLOCKED_INVALID_COST`
- `BLOCKED_MARGIN`
- `BLOCKED_PRICE_CAP`
- `BLOCKED_INVALID_PRICING`

Profitability score is advisory only. It ranks otherwise eligible candidates using gross-margin quality, return on landed cost, and remaining source-freshness window. It does **not** itself publish a product or authorize a supplier purchase.

The owner-only `/api/admin/commerce/assess` endpoint is intentionally non-mutating. It may recommend a selling price and report eligibility, but it must not write `sellingPriceCents`, `landedCostCents`, or `commerceEnabled`.

## Controlled recommendation persistence

After an eligible assessment, an owner may explicitly save the reviewed financial recommendation through `/api/admin/commerce/products/[id]/recommendation`.

This step is deliberately narrower than publication or activation:

- requires the explicit confirmation token `SAVE_RECOMMENDATION`;
- requires owner authorization and the certified financial gate;
- recalculates eligibility server-side at save time rather than trusting client-calculated numbers;
- persists verified `landedCostCents` and the recommended `sellingPriceCents` in integer cents;
- records source timing, explicit landed-cost components, pricing policy, profitability metrics, assessment time, and approving owner in audit metadata;
- writes an operational SystemLog entry;
- refuses to modify an already commerce-enabled product, including a concurrent activation race;
- never writes `commerceEnabled=true` and therefore does not publish the product for direct sale;
- never initiates supplier procurement or any other money-moving operation.

Saving a recommendation means **financially reviewed candidate**, not **live product**.

## Direct-commerce storefront authority

When `commerceEnabled=true`, the public storefront must represent DealForge as the seller and DealForge's integer-cent selling price as the price authority.

For direct-commerce products:

- public DTOs expose `commerceEnabled`, `sellingPriceCents`, and currency but never expose `landedCostCents`;
- the displayed customer price is derived from `sellingPriceCents`, not the supplier/reference `price` field;
- DealForge is labeled as the seller;
- direct purchase is available only when the selling price is a positive safe integer, currency is valid, and availability is `in_stock`;
- checkout begins through DealForge's server-authoritative `/api/checkout` path, which re-reads product price and availability from the database;
- supplier/affiliate links and affiliate disclosures are not presented as the purchase path for a direct-commerce item;
- structured internal recommendation metadata is hidden from public product details;
- malformed or unavailable direct-commerce records fail closed as unavailable instead of falling back to a retailer purchase link.

This storefront work does not itself activate any product. Activation remains a separate owner-controlled gate.

## Controlled activation

A reviewed recommendation becomes purchasable only through `/api/admin/commerce/products/[id]/activation` after a second server-side gate.

Activation:

- requires the explicit confirmation token `ACTIVATE_COMMERCE`;
- requires owner authorization and the certified Phase 2.5 financial gate;
- currently permits only `manual_supplier_purchase` fulfillment, so activation never triggers an unattended supplier order;
- consumes the already-saved recommendation instead of accepting a replacement client price, landed cost, source-verification flag, or source timestamp;
- requires the current catalog source to be trusted `amazon-creators-api` data for the initial guarded rollout;
- requires the current source price and verification timestamp to exactly match the recommendation being activated;
- requires source data no older than six hours;
- requires an approved HTTPS Amazon supplier route and a currently available product;
- requires the persisted `landedCostCents` and `sellingPriceCents` to exactly match the saved recommendation;
- re-runs the commerce eligibility calculation from the current source snapshot and saved cost/pricing policy before activation;
- enforces minimum activation policy floors of 15% gross margin, $2.00 estimated absolute profit, 3% payment-fee allowance, and $0.30 fixed payment-fee allowance;
- uses a conditional write over the reviewed catalog snapshot so concurrent source or financial changes return `ACTIVATION_SOURCE_CHANGED` instead of enabling stale state;
- records activation owner, source snapshot, recommendation reference, fulfillment mode, and financial values in audit metadata and SystemLog.

Only after every check succeeds may the route set `commerceEnabled=true`. Recognized source availability values are normalized to Checkout's canonical `in_stock` state during activation.

The owner can explicitly disable an activated product with `DISABLE_COMMERCE`. Disabling sets `commerceEnabled=false`, preserves the prior activation audit, records who disabled it and when, and requires no supplier purchase or refund action.

## Checkout revalidation

`commerceEnabled=true` is necessary but no longer sufficient for Checkout.

Every new Checkout creation re-runs the activation assessment against the current server-stored product record before creating a Stripe Checkout Session. Checkout therefore fails closed when:

- the Phase 2.5 financial gate is not certified;
- the trusted source marker is missing or changed;
- source availability is no longer acceptable;
- the source verification timestamp has aged past the six-hour window;
- source price or verification timestamp differs from the saved recommendation;
- the saved recommendation falls below activation policy floors;
- persisted financial values no longer match the recommendation;
- the approved supplier route is no longer valid;
- re-calculated landed cost or selling price no longer matches the reviewed recommendation.

A source refresh or source-price change therefore requires a new reviewed recommendation and activation before a new customer Checkout can be created. Checkout does not expose internal profitability or supplier details to the customer; an invalid product is returned only as non-purchasable.

This revalidation narrows the interval between supplier verification and customer charge, but it does not guarantee supplier inventory after a Stripe Checkout Session has already been created. Fulfillment remains manual in this stage, and later procurement automation requires its own pre-purchase revalidation and certification gate.

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

Phase 2.5 now permits Phase 3 to advance, but automatic supplier purchasing remains a separate money-moving control and stays disabled during the current guarded rollout.

Phase 3 may automate:

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

It must not autonomously execute supplier purchases, payouts, transfers, or unreviewed refunds until those specific workflows have their own authorization, limits, idempotency, reconciliation, and production certification.

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
4. `npm run test:commerce-core`
5. existing Stripe payment-integrity tests
6. Cloudflare/OpenNext build
7. Wrangler dry-run
8. production dependency audit
9. verify no product was unintentionally commerce-enabled
10. verify any activated selling price satisfies its saved landed-cost/profit policy and current source snapshot
11. verify Checkout revalidates current activation eligibility before Stripe session creation
12. smoke-test `www.deal-forge.sale`
13. keep bare-apex routing tracked separately until its stale Vercel/DNS conflict is removed

No release may be called production-certified solely because it builds or deploys.
