# Phase 3 — Checkout Exposure & Session Revocation

## Purpose

DealForge must not create an unlimited supplier-sourcing obligation merely because every individual product is otherwise eligible for direct commerce.

This slice adds a transaction-level gate before Stripe Checkout and makes current DealForge safety authoritative over still-open unpaid Checkout Sessions.

## Pilot exposure limits

The initial production limits are intentionally conservative:

- maximum quantity for one product line: **5 units**;
- maximum total units in one checkout: **8 units**;
- maximum customer charge in one checkout: **$1,500 USD**;
- maximum aggregate reviewed landed-cost exposure in one checkout: **$1,000 USD**.

These limits are server-side and must be changed only through reviewed code. Supplier landed-cost totals are internal and are never returned to customers.

## Initial Checkout

Before DealForge creates an Order, Stripe Price, or Stripe Checkout Session, it now requires:

1. the financial certification gate to be active;
2. every product to pass direct-commerce runtime safety and source binding;
3. one supported currency (USD);
4. valid immutable integer-cent pricing;
5. the complete cart to pass the transaction exposure limits.

A failed exposure check returns a generic `CHECKOUT_LIMIT_EXCEEDED` response. Internal supplier exposure is not disclosed.

## Unpaid session revalidation

A previously created Checkout Session is not considered permanently safe.

Before DealForge resumes an unpaid session it revalidates:

- current financial gate state;
- current product commerce activation;
- availability;
- source freshness and verification;
- reviewed supplier identity;
- saved selling-price and landed-cost snapshots;
- order currency and total;
- transaction exposure limits.

If the local checkout is unsafe, DealForge first retrieves the exact Stripe Session and verifies its order identity. A paid/complete Stripe Session is never expired. An open/unpaid matching session is expired at Stripe with an idempotent request, then DealForge returns `CHECKOUT_REVALIDATION_REQUIRED`.

## Scheduled revocation

The signed five-minute maintenance route runs in this order:

1. quarantine unsafe active direct-commerce products;
2. revoke unsafe still-open unpaid Checkout Sessions;
3. monitor paid-order fulfillment SLAs;
4. run lower-priority catalog maintenance.

The revoker scans only recent `pending_payment` and `payment_failed` orders with a Stripe Checkout Session ID. It does not change Order or Product state and does not create refunds, supplier purchases, transfers, or payouts.

## Race handling

A customer can finish payment between DealForge's Stripe Session read and expiration request. If expiration fails, DealForge re-reads Stripe once. If the session became paid/complete, financial truth wins and DealForge does not treat the session as revoked.

## Still gated

This slice does not authorize:

- automatic supplier purchasing;
- autonomous refunds;
- automatic product activation;
- marketplace transfers or payouts.
