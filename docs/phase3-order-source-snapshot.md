# Phase 3 — Order Source Snapshot v1

## Purpose

DealForge validates live persisted Supplier/SupplierOffer state before direct checkout. This slice carries that validated source authority into the Order itself so fulfillment and later reconciliation do not depend on mutable Product metadata after customer payment.

## Authority boundary

For a normal direct-commerce line, the sequence is:

1. Load the Product commercial snapshot.
2. Pass the shared commerce/profit gate.
3. Resolve and validate the exact persisted SupplierOffer binding.
4. Build a canonical `OrderSupplierSnapshotV1` containing supplier identity, offer identity, source class/URL, verification timestamps, inventory confidence, availability, currency, and exact landed-cost components.
5. Persist that serialized snapshot on `OrderItem` before Stripe Checkout Session creation.
6. On an idempotent checkout retry, require the stored supplier snapshot and all order economics to match the freshly validated source.
7. Immediately before Stripe session creation, re-run the persisted-offer binding and require the canonical source snapshot to remain byte-for-byte identical.

If source authority or economics drift, checkout stops and requires a fresh checkout. It does not silently substitute a supplier after an order has been economically fixed.

## Certification exception

The private Stripe test certification product retains its existing isolated test-mode bypass and stores the legacy empty snapshot `{}`. This exception does not apply to normal direct-commerce products.

## Safety properties

- No supplier purchase is performed.
- No inventory reservation is performed.
- No automatic procurement is enabled.
- No broad catalog commerce switch is changed.
- Existing historical OrderItems remain readable with the additive `{}` default.
- A pending checkout cannot be retried against different supplier economics under the same checkout key.
- Future fulfillment/procurement code must treat the OrderItem snapshot as the order-time sourcing record, not re-derive historical economics from the current Product row.

## Next structural step

Introduce a first-class procurement intent/journal keyed to OrderItem and the immutable supplier snapshot. Keep execution manual/disabled initially; use the journal to make sourcing decisions idempotent, auditable, and impossible to duplicate before any supplier adapter can place a real order.
