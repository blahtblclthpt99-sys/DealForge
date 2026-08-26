# Phase 3 — Stripe Dispute / Chargeback Procurement Gate

## Purpose

Protect customer money, supplier spend, and DealForge margin when Stripe reports a payment dispute or chargeback.

Verified Stripe webhook events remain financial truth. A browser response, customer claim, admin action, or supplier state cannot create or clear a dispute financial state.

## Authoritative events

The production Stripe webhook must subscribe to:

- `charge.dispute.created`
- `charge.dispute.updated`
- `charge.dispute.closed`

The existing fee reconciliation path also requires:

- `charge.succeeded`
- `charge.updated`

These subscriptions are production configuration requirements. Code support alone is not certification evidence.

## Financial-state rule

DealForge stores a versioned dispute ledger inside the Stripe payment metadata. Each dispute is bound to:

- Stripe dispute ID
- PaymentIntent ID
- charge ID
- disputed amount
- currency
- latest verified status
- latest Stripe event ID and event creation time

PaymentIntent, charge, amount, and currency bindings are immutable after first observation. Corrupt metadata fails closed. Older events cannot regress newer state, and a terminal dispute outcome cannot be rewritten to a conflicting terminal result.

Order financial status is derived from both the refund ledger and dispute ledger:

- no active dispute + no refund → `paid`
- no active dispute + partial refund → `partially_refunded`
- no active dispute + full refund → `refunded`
- any unresolved/unknown dispute state → `payment_disputed`
- any lost dispute → `payment_dispute_lost`

Unknown future Stripe dispute states intentionally fail closed as active until reviewed.

## Procurement interlock

Procurement approval, manual supplier purchase, shipment recording, and delivery recording already require the authoritative order status to be exactly `paid`.

Therefore `payment_disputed` and `payment_dispute_lost` automatically stop further procurement/fulfillment progression without mutating or destroying the existing procurement journal.

When a dispute safely resolves in the merchant's favor and no other active/lost disputes remain, the order financial status is re-derived from verified payment and refund truth. Procurement can only become eligible again if the resulting status is exactly `paid` and all existing procurement gates still pass.

## Concurrency and replay safety

Stripe event IDs remain idempotent through the existing PaymentEvent ledger and payload SHA-256 replay binding.

Dispute and fee metadata updates additionally use optimistic concurrency on the Payment row. Order financial-state updates use optimistic concurrency on the Order row. A collision throws, rolls back the entire webhook transaction, and leaves Stripe free to retry the event instead of accepting a partial or overwritten financial state.

## Production configuration gate

Before this protection can be called live-certified:

1. Merge and deploy the exact revision that contains dispute handling.
2. Verify normal CI, Cloudflare deployment, database, health, and smoke gates.
3. Add the five required charge/dispute event subscriptions to the existing live Stripe webhook endpoint.
4. Re-read the live endpoint and verify the event list exactly includes the required events.
5. Confirm the live Stripe account currently has no unhandled historical disputes, or reconcile any that exist before enabling commerce.

## Safety boundaries retained

This change does **not**:

- enable automatic supplier purchasing;
- bypass manual procurement authority;
- enable broad live commerce;
- alter tax registration or tax compliance state;
- set `TAX_COMPLIANCE_CERTIFIED=true`;
- remove Issue #170;
- fabricate a chargeback outcome;
- automatically submit dispute evidence to Stripe.

Issue #170 remains an independent deferred external tax-registration gate.