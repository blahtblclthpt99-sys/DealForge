# DealForge Phase 3 — Order Operations & Customer History v1

## Purpose

Add a read-only operational view over paid commerce and make the existing customer-safe tracking projection usable from the customer dashboard.

This slice does not create any new money-moving or supplier-purchasing authority.

## Admin operations feed

`GET /api/admin/commerce/orders` is admin-only and read-only. It covers paid, partially refunded, and refunded orders and derives operational exceptions from persisted financial/procurement state.

### Financial view

Per order it reports:

- order total
- succeeded refunds
- pending refunds
- retained revenue after succeeded refunds
- expected supplier cost
- known actual supplier cost
- projected supplier cost
- projected contribution
- known contribution before unreconciled line costs
- cost reconciliation coverage

A succeeded refund reduces retained revenue. Pending refunds are surfaced separately and generate an operational warning rather than being treated as final financial truth.

### Exception signals

V1 flags:

- paid order line missing a ProcurementIntent — critical
- source-integrity-blocked procurement — critical
- supplier cost overrun — warning
- supplier cost overrun >= 20% — critical
- supplier cost at or above line revenue — critical
- awaiting owner review for >= 24 hours — warning
- manually ordered from supplier but not shipped for >= 72 hours — warning
- shipped but not delivered for >= 14 days — warning
- pending refund — warning
- succeeded refunds exceeding order total — critical integrity signal

These are operational signals only. They do not automatically modify orders, issue refunds, approve sourcing, place supplier purchases, or contact carriers.

## Customer order history

`/dashboard/orders` provides signed-in customers with:

- order number
- order date and order status
- customer-paid total
- product lines and quantities
- simplified fulfillment state
- validated shipment carrier and tracking number
- official carrier tracking link when available
- shipped/delivered dates

The page rehydrates the session user from the database and scopes every query by the current user ID.

It does not expose supplier identity/source snapshots, supplier order references, expected/actual supplier costs, internal source-integrity flags, approving admin identities, or raw procurement events.

## Dashboard navigation

The main customer dashboard now includes an Orders entry linking directly to history and tracking.

## Explicitly not enabled

- automatic remediation of operational exceptions
- automatic refunds
- automatic supplier purchase or substitution
- automatic carrier polling
- customer access to internal procurement economics
- cross-customer order lookup

## Next

The next transaction-sensitive slice should explicitly define cancellation/refund interactions with procurement state so a refund or cancellation cannot race a manual supplier order or shipment record. That gate should be certified before any autonomous procurement authority is considered.
