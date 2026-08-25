# Phase 3 — Procurement Intent Journal v1

## Purpose

DealForge now carries exact supplier provenance and cost economics into each OrderItem before Stripe Checkout. The next boundary is to turn a verified paid order into an auditable sourcing obligation without allowing software to place a supplier order.

## Financial trigger

A ProcurementIntent may be created only from the verified Stripe webhook transaction after DealForge has:

1. verified Stripe's signature and mode,
2. resolved the order binding,
3. verified amount and currency,
4. reconciled the successful Payment row, and
5. marked the local Order `paid`.

Intent creation occurs in that same Prisma transaction. If the intent journal cannot be written safely, the local transaction fails and Stripe can retry the event. DealForge does not acknowledge a partially reconciled paid order.

## One intent per order line

`ProcurementIntent.orderItemId` is unique. Its idempotency key is derived from the OrderItem ID. Stripe retries and multiple successful-event shapes therefore converge on the same intent instead of creating duplicate sourcing obligations.

Each intent copies the OrderItem's immutable `supplierSnapshot`, quantity, currency, and expected cost basis. Existing intent economics are never silently rewritten by a webhook replay.

## States in v1

### `awaiting_review`

The paid OrderItem has a valid immutable supplier snapshot whose currency and landed cost match the OrderItem. It is ready for owner review only.

### `blocked_source_integrity`

The order predates supplier snapshots or its source/cost record is malformed or inconsistent. DealForge creates a blocked operational record rather than reconstructing or guessing a supplier after payment.

## Execution policy

Every v1 intent has:

`executionMode = manual_only`

The data model includes future audit fields for approval, supplier order reference, actual cost, and execution time, but this slice exposes no supplier adapter, purchase endpoint, automated purchasing worker, or inventory reservation path.

## Audit journal

Every intent receives one idempotent ProcurementEvent documenting whether verified payment produced a reviewable or blocked intent. Events are append-oriented operational evidence and are linked directly to the intent.

## Next step

Build an owner-only procurement review console and state machine on top of ProcurementIntent. The first version should permit inspection, hold/release decisions, source-integrity acknowledgement, and recording of a manually placed supplier order. Supplier purchasing must remain external/manual until separate authorization, spend, idempotency, cost-variance, cancellation, and reconciliation gates are certified.
