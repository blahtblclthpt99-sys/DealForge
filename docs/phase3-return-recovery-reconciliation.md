# Phase 3 — Return & Recovery Reconciliation v1

This phase closes the accounting loop created by post-purchase refund exceptions without enabling automatic supplier recovery.

## Invariants

- Stripe refund state remains authoritative for whether a refund succeeded.
- A recovery case exists only when a `POST_PURCHASE_REFUND_EXCEPTION_APPROVED` event exists for the same refund idempotency key.
- Recovery is reconciled against recorded supplier cost exposure (`ProcurementIntent.actualTotalCostCents`), not merely against the customer refund amount.
- Customer and supplier return evidence is quantity-aware; partial evidence cannot satisfy a full-line return requirement.
- Supplier credits and explicit unrecovered-loss acknowledgements may not together exceed recorded supplier cost.
- Unrecovered loss cannot be accepted while the refund is merely pending.
- A case cannot close until the refund is `succeeded`, required return evidence is complete, and supplier cost exposure is fully accounted for by recovery plus explicitly accepted loss.
- Closing a recovery case never rewinds shipment or delivery history.

## Owner actions

`POST /api/admin/procurement/:id/recovery`

Supported journal actions:

1. `RECORD_CUSTOMER_RETURN_RECEIVED`
2. `RECORD_SUPPLIER_RETURN_SENT`
3. `RECORD_SUPPLIER_RECOVERY`
4. `ACCEPT_UNRECOVERED_LOSS`
5. `CLOSE_RECOVERY`

All actions are admin-only, bounded, journaled, and idempotent. Supplier/carrier network calls are not made.

## Concurrency

Recovery mutations acquire a PostgreSQL row lock on the procurement intent with `SELECT ... FOR UPDATE`. This serializes recovery accounting without changing `ProcurementIntent.updatedAt`, so shipment-aging and operational timers remain truthful.

## Operational visibility

The admin procurement queue now exposes each intent's recovery cases, open case count, supplier exposure, recovered amount, accepted loss, remaining exposure, return quantities, refund status, and close eligibility.

## Deliberate limits

V1 does not:

- automatically cancel supplier orders;
- automatically create supplier returns;
- poll suppliers for credit status;
- automatically accept losses;
- automatically close recovery cases;
- alter customer shipment history;
- infer recovery from a refund alone.

Those capabilities require separately certified supplier adapters and financial controls.
