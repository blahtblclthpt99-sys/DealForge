# Phase 3 — Customer Fulfillment Truth Gate

## Purpose

Prevent shopper-facing order history from presenting shipment or delivery claims when the underlying fulfillment journal is ambiguous or inconsistent with the current procurement state.

## Public projection rules

Customer-visible shipment data now fails closed unless:

- exactly one `RECORD_SHIPMENT` event exists;
- the shipment payload is canonical and valid;
- no more than one `MARK_DELIVERED` event exists;
- any delivery payload is canonical and valid;
- the delivery timestamp is not earlier than the shipment timestamp; and
- the journal-derived state exactly agrees with the internal procurement state.

If any of those conditions fail, the customer API returns fulfillment as `processing` and suppresses tracking data rather than presenting a potentially false shipped/delivered claim.

## Safety boundaries

This gate is read-only. It does not:

- mutate orders, procurement intents, or journal events;
- call carriers or suppliers;
- infer delivery from a third-party network;
- enable automatic procurement;
- change Stripe payment or refund state;
- alter tax configuration or the broad-commerce release lock.

Issue #170 remains the independent legal/live-tax release blocker.
