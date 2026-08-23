# DealForge Phase 3 — Controlled Publication Gate

This slice converts Phase 3 pricing and eligibility results into an explicit, owner-controlled catalog publication action. It does **not** introduce autonomous supplier purchasing, automatic refunds, marketplace transfers, commissions, or payouts.

## Publication authority

A product becomes purchasable only when the configured DealForge product owner explicitly publishes it through the server-side commerce publication route. The route rehydrates the signed-in user and enforces `isProductOwner` server-side.

Client assertions such as `sourceVerified`, `sourceAvailable`, source price, source timestamp, landed cost, selling price, or `commerceEnabled` are not accepted as catalog truth.

## Source-of-truth requirements

For the initial guarded rollout, a product can pass source verification only when its stored catalog metadata identifies `amazon-creators-api` as the trusted price source. Products awaiting enrichment, products marked storefront-blocked, unapproved/manual price sources, stale prices, unavailable products, malformed prices, and unsupported currencies fail closed.

The source price is converted from the persisted catalog price to integer cents on the server. The stored source verification timestamp must remain within the six-hour publication freshness window. Recognized available source states are normalized to the checkout-safe canonical value `in_stock` only after the product passes the publication gate.

## Minimum profit policy

Publication applies server-side floors even when an operator requests weaker assumptions:

- minimum target gross margin: 15% (`1500` basis points);
- minimum estimated absolute profit: $2.00 (`200` cents);
- minimum payment-fee allowance: 3% (`300` basis points);
- minimum fixed payment-fee allowance: $0.30 (`30` cents).

Operators may request stricter values. They cannot use the publication endpoint to weaken these floors. Existing price ceilings remain fail-closed: DealForge blocks the product rather than silently sacrificing the required margin.

## Atomic publication

Before writing commerce state, DealForge assesses:

1. Phase 2.5 financial-gate certification;
2. stored source trust;
3. source availability;
4. source freshness;
5. integer-cents landed cost;
6. payment-fee allowance;
7. minimum absolute profit;
8. target gross margin;
9. optional price floor and ceiling.

Successful publication atomically persists `commerceEnabled=true`, the server-generated `sellingPriceCents`, the calculated `landedCostCents`, normalized availability, and publication audit metadata. An optimistic catalog snapshot check prevents a concurrent price/source refresh from racing the publication write. If the source row changed, publication returns `PRODUCT_CHANGED_REASSESS` and the operator must assess the current data again.

## Disable path

The owner can immediately disable commerce for a product. Disabling sets `commerceEnabled=false`, preserves prior financial/audit metadata, records the disable time, and invalidates catalog caches. Checkout already requires `commerceEnabled=true`, so a disabled product cannot create a new order line.

## Audit trail

Publication records the source price, source timestamp, trusted price source, effective pricing policy, cost assumptions, estimated profit, gross margin, profitability score/tier, persisted selling price, and persisted landed cost. Publish and disable actions also create `SystemLog` entries.

## Explicit non-goals

This publication gate does not:

- autonomously discover and publish products;
- buy from a supplier;
- guarantee supplier inventory after customer payment;
- execute refunds without the existing controlled refund path;
- transfer or pay out funds;
- enable marketplace seller money movement.

Those actions require separate authorization, idempotency, limits, reconciliation, operational failure handling, and production certification before they may become autonomous.
