# Phase 3 — Shipment Purchase Reconciliation Gate

## Purpose

Prevent fulfillment state from advancing on stale or mismatched manual-purchase evidence during the interval between periodic purchase-reconciliation sweeps.

## Gate

Before either `RECORD_SHIPMENT` or `MARK_DELIVERED` can transition a procurement intent, the owner shipment route now rehydrates and reconciles the current authoritative manual-purchase projection inside the same database transaction.

The reconciliation binds:

- procurement status
- immutable `RECORD_MANUAL_PURCHASE` event and deterministic event key
- supplier order reference
- actual supplier cost
- execution timestamp presence
- quantity
- currency
- expected total cost
- order-line revenue
- immutable supplier/source lock
- persisted supplier identity
- persisted offer identity
- purchase evidence hash

If any field is missing, malformed, duplicated, or mismatched, fulfillment fails closed with `PROCUREMENT_PURCHASE_RECONCILIATION_REQUIRED` before the state transition is calculated or persisted.

## Traceability

Successful shipment and delivery events include the reconciled `purchaseEvidenceHash`, binding the fulfillment journal to the exact purchase evidence that passed the gate.

## Safety boundaries

This gate does not:

- place supplier orders
- call supplier APIs
- enable automatic procurement
- change `executionMode`
- rewrite purchase evidence, supplier references, or supplier costs
- issue Stripe payments or refunds
- mutate tax registrations
- auto-mark shipments or deliveries

Broad live commerce and automatic supplier purchasing remain locked under their existing independent gates.
