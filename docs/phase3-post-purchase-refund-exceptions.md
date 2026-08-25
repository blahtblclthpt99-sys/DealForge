# Phase 3 — Post-Purchase Refund Exceptions v1

## Purpose

DealForge must sometimes refund a customer after a supplier purchase has already been recorded, shipped, or delivered. This path is exceptional because the customer refund can create unrecovered supplier cost.

This phase adds a narrow owner-controlled exception path without weakening the refund/procurement interlock.

## Required controls

A post-purchase refund requires all of the following:

- explicit acknowledgement that fulfillment may be irreversible
- a typed recovery plan
- a meaningful operator note
- explicit unrecovered-loss acknowledgement when the customer keeps the item
- a durable ProcurementEvent for every affected procurement intent
- a fresh transactional re-check of order, refund, and procurement state before Stripe is called

## Recovery plans

- `supplier_cancel_requested` — supplier cancellation is being pursued manually
- `supplier_return_required` — supplier return/recovery is required manually
- `customer_return_required` — customer return is required and will be reconciled manually
- `customer_keep_accept_loss` — DealForge knowingly accepts unrecovered supplier cost; explicit loss acknowledgement is mandatory

## Financial truth

Stripe remains authoritative for refund financial state. The exception event records operator authorization and recovery intent; it does not claim the refund succeeded.

## Deliberate non-features

This phase does not add:

- automatic supplier cancellation
- automatic supplier return
- automatic return labels
- automatic customer refunds
- automatic procurement
- automatic supplier credits
- automatic loss write-offs
- backwards procurement-state rewinds

Existing shipment and delivery history remains immutable. Recovery is an auditable operational process layered on top of that history.
