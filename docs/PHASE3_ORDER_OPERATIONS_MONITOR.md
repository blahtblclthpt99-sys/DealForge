# DealForge Phase 3 — Order Operations Monitor

This slice adds observational SLA monitoring around the existing owner-controlled sourcing and fulfillment state machine.

## Source-of-truth boundaries

- Stripe webhook reconciliation remains the authority for financial `Order.status`.
- Owner fulfillment actions remain the authority for sourcing/shipping/delivery state.
- The operations monitor does not change either state machine.
- The monitor never purchases from a supplier, refunds a customer, activates a product, or changes a customer order.

## Default attention thresholds

The monitor evaluates only financially `paid` orders:

- `awaiting_sourcing`: warning after 2 hours, critical after 6 hours.
- `sourcing`: warning after 6 hours, critical after 24 hours.
- `supplier_ordered`: warning after 24 hours, critical after 72 hours.
- `shipped`: warning after 5 days, critical after 10 days.
- `hold`: warning after 24 hours, critical after 72 hours.
- `delivered`: complete and not actionable.

These are operational attention thresholds, not automatic cancellation/refund rules.

## Alert behavior

The signed maintenance route runs the monitor after direct-commerce quarantine and before lower-priority catalog maintenance.

For an overdue order it writes an internal `SystemLog` alert under `order-operations-alert:<orderId>`. Alerts are deduplicated using a fingerprint containing the fulfillment state, state-entry timestamp, reason, and severity. A warning can therefore escalate once to a critical alert without generating the same record every five minutes.

## Owner console

The owner-only paid-order queue uses the same pure health evaluator as the scheduled monitor. Each order receives an `operationsHealth` result and warning/critical orders are surfaced directly in the fulfillment console.

## Release safeguards

Commerce-core tests verify the threshold model and alert fingerprints. A source-level safety regression test verifies that the monitor:

- scans only paid orders;
- does not mutate `Order` records;
- does not mutate `Product` records;
- does not call Stripe;
- keeps automatic supplier purchasing disabled;
- remains scheduled after direct-commerce quarantine.
