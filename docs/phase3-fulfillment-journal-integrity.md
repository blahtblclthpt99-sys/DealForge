# Phase 3 — Fulfillment Journal Integrity Gate

## Purpose

Close the remaining evidence-chain gap between a reconciled manual supplier purchase, shipment recording, and owner-recorded delivery.

PR #190 already requires purchase reconciliation inside shipment and delivery transactions. This gate additionally requires delivery to prove that the shipment journal itself is singular, structurally valid, quantity-consistent, and bound to the exact purchase-evidence hash that currently reconciles.

## Delivery gate

Before `MARK_DELIVERED` may advance `shipped → delivered`, DealForge now requires:

- exactly one `RECORD_SHIPMENT` event;
- a valid canonical shipment payload;
- shipment quantity equal to the procurement quantity;
- a valid SHA-256-shaped purchase evidence hash in the shipment journal;
- that shipment purchase evidence hash to exactly equal the current reconciled manual-purchase evidence hash.

Any missing, duplicate, malformed, or drifted shipment evidence fails closed with `SHIPMENT_JOURNAL_RECONCILIATION_REQUIRED` before the delivery timestamp or fulfillment state is persisted.

## Traceability

A successful delivery journal records both:

- the exact `shipmentEventKey` that passed reconciliation; and
- the exact reconciled `purchaseEvidenceHash`.

This gives the delivery event an explicit chain back through shipment to the immutable manual-purchase evidence.

## Safety boundaries

This gate does not:

- place supplier orders;
- call supplier or carrier APIs;
- infer delivery from tracking networks;
- automatically ship or mark delivered;
- enable automatic procurement;
- alter Stripe payments or refunds;
- create or change tax registrations;
- change the broad-commerce release locks.

Procurement remains `manual_only`, and Issue #170 remains the independent live tax/legal release blocker.
