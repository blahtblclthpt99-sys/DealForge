# DealForge Phase 3 — Profit Opportunity Queue

This slice prioritizes saved owner-reviewed direct-commerce recommendations without granting any new activation authority.

## Ranking authority

The queue does not create a second pricing or AI score. It reuses the audited values already saved by the commerce recommendation workflow and orders candidates by:

1. current activation readiness;
2. saved profitability tier;
3. saved profitability score;
4. saved estimated contribution after the pricing model's estimated payment fee;
5. saved gross margin;
6. source freshness remaining.

Click and view counts are returned as demand context only. They do not affect ranking.

## Revalidation

Before a candidate is labeled ready for owner activation review, the queue reuses the same activation-readiness validation and supplier source-binding checks used by the guarded commerce flow. A stale source, financial drift, unavailable inventory, invalid currency, disabled financial gate, changed retailer, changed supplier URL, or changed ASIN blocks readiness.

## Access and mutation boundary

The API is private/no-store and restricted to the configured product owner. It scans only products whose saved specifications contain an `owner_reviewed_recommendation` and whose `commerceEnabled` flag is false.

The queue is advisory only:

- it cannot write `commerceEnabled`;
- it cannot mutate products or orders;
- it cannot call Stripe;
- it cannot purchase from suppliers;
- it does not bypass the activation attestations in the Commerce Control Center.

The owner UI provides the product ID and supplier source for manual verification before any separate activation decision.

## Scale bound

The API evaluates at most the 250 most recently updated reviewed candidates and returns at most 100 ranked results. The UI renders the first 25 to stay usable on mobile.
