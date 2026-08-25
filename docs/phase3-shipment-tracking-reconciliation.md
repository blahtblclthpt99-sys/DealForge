# DealForge Phase 3 — Shipment Tracking & Cost Reconciliation v1

## Purpose

Extend the verified-payment and manual-procurement chain through shipment and delivery without enabling automated supplier purchasing.

Canonical lifecycle:

`Stripe verified paid order -> ProcurementIntent -> owner manual approval -> manually recorded supplier order -> shipment journal -> delivery journal`

## State transitions

The procurement state machine adds two one-way transitions:

- `supplier_ordered_manual -> shipped` via `RECORD_SHIPMENT`
- `shipped -> delivered` via `MARK_DELIVERED`

Shipment cannot be recorded before the owner has already recorded a manual supplier purchase. Delivery cannot be recorded before a valid shipment journal event exists.

## Shipment journal

Shipment data is stored as a typed v1 payload inside the immutable `ProcurementEvent` journal instead of creating a second mutable fulfillment ledger.

The shipment payload contains only:

- carrier code
- normalized carrier display name
- normalized tracking number
- DealForge-generated official carrier tracking URL when the carrier is known
- quantity
- shipped timestamp

V1 supports UPS, USPS, FedEx, DHL, and `other`. Arbitrary tracking URLs are not accepted. Unknown carriers receive no generated tracking URL.

## Delivery journal

Delivery is another immutable procurement event containing a validated delivery timestamp. The delivery timestamp must not precede the recorded shipment timestamp.

## Owner controls

`POST /api/admin/procurement/:id/shipment` requires current admin authorization and transactionally revalidates:

- procurement intent exists
- execution mode remains `manual_only`
- source integrity is not blocked
- associated order remains verified paid
- expected state is current
- manual supplier purchase reference exists before shipment
- actual supplier cost is recorded before shipment
- manual purchase execution timestamp exists
- optimistic concurrency token (`status + updatedAt`) still matches

No supplier network request or carrier API request is made.

## Customer-safe projection

`GET /api/account/orders` rehydrates the signed-in user against the database and scopes orders by the current user ID.

The customer response contains order economics the customer already owns (purchase totals), product lines, a simplified fulfillment state, and validated carrier tracking.

It intentionally does not expose:

- supplier snapshot or source URL
- supplier order reference
- expected or actual supplier cost
- blocked source-integrity reason
- approving admin identity
- internal procurement event detail

Internal procurement states collapse to `processing` until shipment occurs.

## Actual-cost reconciliation

The owner procurement queue now calculates, after a manual supplier purchase is recorded:

- expected supplier total
- actual supplier total
- cost variance
- line revenue
- gross margin in cents
- gross margin basis points

These figures are observational. They do not authorize purchasing and do not mutate customer payment state.

## Explicitly not enabled

- automated supplier purchasing
- supplier adapters that place orders
- automatic supplier substitution
- automatic carrier polling
- arbitrary external tracking URLs
- partial/multi-package fulfillment
- buyer visibility into supplier economics

Partial shipments and automated carrier-event ingestion require a later independently certified design.
