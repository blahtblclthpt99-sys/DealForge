# Stripe fee reconciliation v1

## Purpose

DealForge must not estimate payment-processing fees when certifying order contribution. This gate records exact Stripe charge fee evidence from the balance transaction tied to the succeeded charge.

## Automatic path

Verified `charge.succeeded` and `charge.updated` webhooks may reconcile a fee only when the event contains a PaymentIntent and balance-transaction reference. DealForge retrieves the referenced Stripe balance transaction before claiming the local webhook event, validates its identity and arithmetic, then stores the fee evidence on the existing succeeded Payment record inside the webhook transaction.

If Stripe retrieval fails, the webhook is not claimed and remains retryable. If the charge event arrives before the local succeeded Payment exists, processing fails closed so Stripe can retry after the payment event has been processed.

## Stored evidence

Payment metadata records:
- processing fee cents
- fee currency
- authoritative source
- Stripe charge ID
- Stripe balance transaction ID
- balance transaction gross and net
- reconciliation timestamp
- webhook event ID when event-driven

Existing fee evidence is immutable unless the complete evidence tuple is identical.

## Backfill path

`POST /api/admin/finance/reconcile?orderId=...` or `?orderNumber=...` performs a controlled admin-only fee backfill for an existing Stripe payment. It expands the PaymentIntent latest charge and balance transaction, validates the evidence, re-reads the Payment in a transaction, and uses optimistic concurrency to avoid overwriting a concurrent webhook reconciliation.

`GET` remains a diagnostic reconciliation view and now reports whether fee evidence is available.

## Profit certification

An unrefunded order can only have certified order contribution when the Payment metadata contains complete authoritative Stripe fee provenance and valid gross/net arithmetic.

Refunded orders remain uncertified in v1 even when the original charge fee is known because refund-side Stripe balance effects are not yet journaled. They expose `REFUND_PROCESSING_ADJUSTMENT_UNKNOWN` rather than assuming those effects are zero.

## Safety boundaries

- No guessed Stripe percentage fee.
- No supplier action.
- No procurement authority increase.
- No schema migration.
- Stripe webhook signature and mode verification remain unchanged.
- Stripe and the verified balance transaction remain the authority for processing-fee evidence.
