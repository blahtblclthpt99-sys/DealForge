# Phase 3 — Refund-side Stripe financial reconciliation v1

## Purpose

DealForge must not certify post-refund contribution using only the customer refund amount. A Stripe refund can have its own account-balance transaction and processing fee effects. This phase records those effects from Stripe while preserving verified webhooks as financial truth.

## Accounting boundary

For a succeeded refund:

- the refund principal reduces customer receipts exactly once through the `Refund` ledger;
- the refund balance transaction is retained as immutable audit evidence;
- only the verified Stripe fee from that refund balance transaction is added to payment-processing cost;
- the refund principal is **not** subtracted again as a processing expense.

For a failed refund:

- any initial refund balance transaction and failure balance transaction can both be journaled;
- the failed refund does not reduce succeeded customer-refund receipts;
- contribution certification remains blocked with manual-review status even when the failure reversal is recorded.

## Durable journal

`RefundFinancialEvent` records one immutable row per Stripe balance transaction linked to a DealForge refund. The Stripe balance transaction ID is globally unique in the journal and each deterministic event key is unique.

Recorded evidence includes:

- DealForge refund ID;
- Stripe refund ID;
- Stripe PaymentIntent ID when supplied;
- Stripe event ID when the evidence came from a webhook;
- Stripe balance transaction ID;
- event kind (`refund_balance` or `refund_failure_balance`);
- amount, fee, net, and currency;
- Stripe transaction type/reporting category;
- Stripe source object ID.

## Webhook behavior

For `refund.created`, `refund.updated`, and `refund.failed`:

1. validate the Stripe signature and expected live/test mode;
2. inspect refund financial references;
3. retrieve referenced Stripe balance transactions when they are not expanded;
4. validate identity, amount direction, fee/net arithmetic, currency, and linkage;
5. only then claim the Stripe event in the local `PaymentEvent` ledger;
6. reconcile the authoritative Refund row;
7. append immutable `RefundFinancialEvent` evidence in the same database transaction.

External Stripe evidence is prepared before the local event is claimed. A transient Stripe API retrieval failure therefore remains retryable and cannot create a half-recorded local financial event.

## Admin backfill

`POST /api/admin/finance/reconcile?orderId=...` (or `orderNumber`) also retrieves each existing Stripe refund and its balance transactions. It records evidence only when the local refund's Stripe ID, status, amount, currency, PaymentIntent binding, and concurrency version remain consistent.

The backfill never changes refund status. Stripe webhooks remain authoritative for refund state.

The endpoint reports `reconciled: false` when a succeeded refund does not yet have exactly one canonical refund-balance event, or when a pending/failed refund remains.

## Contribution certification

A zero-tax refunded order can regain certified order contribution after all existing gates pass and every succeeded refund has exact refund-side balance evidence.

Certified payment-processing cost is:

`original charge fee + verified succeeded-refund fees`

A refunded order remains uncertified when any of the following applies:

- succeeded refund balance evidence is missing, duplicated, cross-currency relative to the order, or malformed;
- a refund is pending;
- a refund failed and requires manual review;
- charge fee evidence is incomplete;
- supplier cost/recovery accounting is incomplete;
- tax allocation is unknown.

## Tax boundary

This phase does not guess refunded tax. If an order has collected tax and later receives a succeeded refund, contribution remains blocked with `REFUND_TAX_ALLOCATION_UNKNOWN` until a separate authoritative tax-allocation ledger is implemented.

## Safety / non-features

This phase does not:

- infer Stripe fees from a percentage schedule;
- modify refund state from the admin reconciliation endpoint;
- call suppliers or carriers;
- enable automatic supplier purchasing;
- enable automatic returns/recovery;
- alter procurement authority;
- count refund principal twice;
- claim tax recovery or tax liability without authoritative allocation evidence.
