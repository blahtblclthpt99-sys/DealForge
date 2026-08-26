# Phase 3 — Procurement Purchase Reconciliation Recovery Gate

## Purpose

A `manual_purchase_reconciliation_failed` blocker must never be cleared merely because an owner clicks through a warning. Recovery is allowed only after the current procurement projection again reconciles exactly to the immutable `RECORD_MANUAL_PURCHASE` execution evidence.

## Recovery contract

1. Purchase execution evidence remains immutable.
2. Purchase, shipment, and delivery history is never rewritten by this recovery gate.
3. The owner-only integrity view shows current reconciliation reasons and the immutable execution evidence used for comparison.
4. A resolution token binds the current procurement intent revision (`updatedAt`) to the immutable purchase evidence hash and source lock.
5. Resolution requires an explicit owner acknowledgement and a bounded audit note.
6. The server acquires a row lock, reloads current state, reruns reconciliation, and recomputes the resolution token inside the transaction.
7. If any mismatch remains or the token is stale, recovery fails closed.
8. Only `blockedReason` may be cleared, and only when it is exactly `manual_purchase_reconciliation_failed`.
9. A deterministic `PURCHASE_RECONCILIATION_RESOLVED` event records the owner, evidence hash, source lock, supplier-order key/reference, cost, quantity, currency, preserved status, and note.
10. Retries after a successful resolution are idempotent through the deterministic resolution event key.

## Explicit non-authority

This gate does not:

- place supplier orders;
- change procurement execution mode;
- enable automatic supplier purchasing;
- change purchase cost, supplier reference, source snapshot, quantity, status, shipment, or delivery history;
- create or mutate Stripe payments or refunds;
- change tax registrations or commerce activation flags.

Automatic supplier purchasing remains disabled and procurement execution remains `manual_only`.
