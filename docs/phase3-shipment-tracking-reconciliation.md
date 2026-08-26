# DealForge Phase 3 — Shipment Tracking, Multi-Package Fulfillment & Cost Reconciliation v2

## Purpose

Extend the verified-payment and manual-procurement chain through package-level shipment and delivery without enabling automated supplier purchasing or carrier automation.

Canonical lifecycle:

`Stripe verified paid order -> ProcurementIntent -> owner manual approval -> manually recorded supplier order -> one or more immutable package shipment events -> package delivery events -> fully delivered`

## State transitions

The procurement state machine remains one-way at the commercial level:

- `supplier_ordered_manual -> shipped` when the first package is recorded
- `shipped -> shipped` while additional packages are recorded or only part of the shipment set has been delivered
- `shipped -> delivered` only when the full ordered quantity has been shipped and every recorded package has a valid delivery event

Shipment cannot be recorded before the owner has already recorded a manual supplier purchase. Delivery cannot be recorded before a valid shipment journal event exists.

## Package identity

New shipment events use a v2 payload with a deterministic `packageId` derived from the normalized carrier code and tracking number. The package ID is not user-selectable.

This gives each package an immutable identity while preserving the existing `ProcurementEvent` journal as the source of fulfillment truth. No mutable shipment table is introduced.

Legacy v1 shipment and delivery events remain readable. New records are written as v2.

## Cumulative quantity integrity

Before every shipment write DealForge rebuilds the shipment journal and calculates cumulative shipped quantity.

The server rejects:

- shipment quantity above the remaining ordered quantity
- an additional package after the entire ordered quantity has already been shipped
- duplicate deterministic package identities
- malformed historical shipment or delivery events

The final procurement status cannot become `delivered` until:

1. cumulative shipped quantity equals the authoritative procurement quantity, and
2. every recorded package has exactly one valid delivery event.

A package may be delivered while another package has not yet shipped; the overall procurement status remains `shipped` until the complete fulfillment condition is satisfied.

## Shipment journal

Shipment data remains a typed payload inside immutable `ProcurementEvent` records.

A new v2 shipment contains:

- deterministic package ID
- carrier code
- normalized carrier display name
- normalized tracking number
- DealForge-generated official carrier tracking URL when the carrier is known
- package quantity
- shipped timestamp

Supported carriers remain UPS, USPS, FedEx, DHL, and `other`. Arbitrary tracking URLs are not accepted. Unknown carriers receive no generated tracking URL.

The event key uses the deterministic package ID, giving the database uniqueness constraint a second line of defense against duplicate package journal writes.

## Delivery journal

New v2 delivery events bind directly to one package ID and contain a validated delivery timestamp.

The server rejects:

- delivery for an unknown package
- duplicate delivery for an already-delivered package
- delivery timestamp earlier than that package's shipped timestamp
- omitted package identity when more than one package is awaiting delivery

For backward compatibility, a package ID may be omitted only when exactly one undelivered package exists.

## Owner controls

`POST /api/admin/procurement/:id/shipment` requires current owner authorization and transactionally revalidates:

- procurement intent exists
- execution mode remains `manual_only`
- source integrity is not blocked
- associated order remains verified paid
- expected state is current
- manual supplier purchase reference exists before shipment
- actual supplier cost is recorded before shipment
- manual purchase execution timestamp exists
- immutable shipment journal parses successfully
- package quantity stays within remaining ordered quantity
- package identity is not already recorded
- delivery targets a valid undelivered package
- optimistic concurrency token (`status + updatedAt`) still matches

The owner `/admin/procurement` surface now exposes a manual fulfillment panel for recording packages and package deliveries. It does not expose supplier snapshots or create supplier orders.

No supplier network request or carrier API request is made.

## Customer-safe projection

`GET /api/account/orders` rehydrates the signed-in user against the database and scopes orders by current user ID.

Each order item now exposes:

- existing backward-compatible `shipment` projection for the first package
- `shipments[]` with each safe package's carrier, tracking number, official tracking URL, quantity, shipped time, and delivered time
- simplified overall fulfillment state

The customer dashboard renders every package independently.

The customer response still does not expose:

- supplier snapshot or source URL
- supplier order reference
- expected or actual supplier cost
- blocked source-integrity reason
- approving admin identity
- internal procurement event detail

Internal procurement states collapse to `processing` until shipment occurs.

## Actual-cost reconciliation

The owner procurement queue continues to calculate, after a manual supplier purchase is recorded:

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
- customer-visible supplier economics
- automatic delivery inference
- fulfillment status mutation from external carrier data

Automated carrier-event ingestion requires a later independently certified design.
