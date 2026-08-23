# Phase 3 Customer Order Status

DealForge provides a customer-facing order status view without exposing internal procurement or margin data.

## Access model

Guest checkout receives an opaque HMAC-SHA256 order access token in the Stripe Checkout success URL. The token is bound to the DealForge order ID, order number, and creation timestamp. Order numbers by themselves do not grant access.

Signed-in customers may view an order without the link token only when the Order record is directly owned by their authenticated user ID. Email-address matching is not used as an authorization shortcut.

Order status pages are marked no-index and no-referrer so signed access tokens are not intentionally propagated to search engines or downstream navigation.

## Customer-visible data

The customer projection is limited to:

- order number;
- financial state derived from DealForge's Stripe-authoritative order status;
- fulfillment state derived from the audited fulfillment journal;
- customer prices, shipping, tax, total, and succeeded refund amount;
- purchased item titles and quantities;
- carrier and tracking number once shipping has been recorded;
- order/payment/update timestamps.

The customer view intentionally excludes:

- supplier order references;
- supplier URLs or ASIN binding details;
- landed cost or actual procurement cost;
- cost variance or margin/profit data;
- fulfillment internal notes;
- owner/admin user IDs;
- recommendation and activation audit internals.

## Financial truth

Arrival on `/checkout/success` never marks an order paid. Stripe webhook processing remains authoritative. The success page only offers the signed status link; the order status page reads the current DealForge financial and fulfillment records.
